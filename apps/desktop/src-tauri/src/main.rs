//! App de escritorio de GameAgenda para Windows (§17.3 de prototipe.md; ADR-010).
//!
//! Envoltorio mínimo de `ga-web`, nunca un segundo motor: la ventana carga el origen publicado
//! (o el de Vite con `tauri dev`) y esta parte nativa solo aporta lo que la web no puede tener:
//!
//! - el atajo global `Ctrl+Mayús+Espacio`, que pone la ventana delante con la paleta abierta y,
//!   si ya estaba delante, la oculta;
//! - el icono de la bandeja («Abrir», el estado del atajo, «Iniciar con Windows» y «Salir»);
//! - una sola instancia y el arranque con Windows (desactivado por defecto).
//!
//! La página no recibe ninguna orden de Tauri (CA3.8): no hay `capabilities/` ni comandos propios,
//! y `ga-web` se carga como origen remoto, así que Tauri rechaza cualquier `invoke` que intente.
//! Para abrir la paleta, esta parte ejecuta en la página un evento fijo (`CAPTURE_SCRIPT`) que el
//! *router* de la web atiende; la página nunca habla con la parte nativa.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    AppHandle, Manager, Runtime, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
    menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    webview::NewWindowResponse,
};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_global_shortcut::{
    Code, GlobalShortcutExt as _, Modifiers, Shortcut, ShortcutState,
};

const MAIN_WINDOW: &str = "main";
const TRAY_ICON: &str = "main";

/// Argumento con el que Windows abre la app al iniciar sesión: la ventana empieza oculta.
const AUTOSTART_ARG: &str = "--autostart";

/// Lo que se ejecuta en la página al pulsar el atajo. El nombre del evento es el de
/// `DESKTOP_CAPTURE_EVENT` en `apps/web/src/desktop/desktop-capture.ts` (lo comprueba
/// `apps/desktop/desktop.test.ts`). WebView2 lo ejecuta fuera de la CSP de la página, como las
/// DevTools, así que `script-src 'self'` no lo bloquea.
const CAPTURE_SCRIPT: &str = "window.dispatchEvent(new Event('gameagenda:capture'));";

const MENU_OPEN: &str = "open";
const MENU_SHORTCUT: &str = "shortcut";
const MENU_AUTOSTART: &str = "autostart";
const MENU_QUIT: &str = "quit";

fn capture_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space)
}

/// Si el atajo está registrado o lo tiene otra aplicación (CA3.8: el menú lo dice).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ShortcutStatus {
    Ready,
    Busy,
}

impl ShortcutStatus {
    fn menu_text(self) -> &'static str {
        match self {
            Self::Ready => "Atajo: Ctrl+Mayús+Espacio",
            Self::Busy => "Ctrl+Mayús+Espacio lo usa otra aplicación · Reintentar",
        }
    }

    /// Con el atajo ocupado, la fila se puede pulsar para volver a intentarlo.
    fn menu_enabled(self) -> bool {
        self == Self::Busy
    }

    fn tooltip(self) -> &'static str {
        match self {
            Self::Ready => "GameAgenda · Ctrl+Mayús+Espacio",
            Self::Busy => "GameAgenda · El atajo Ctrl+Mayús+Espacio lo usa otra aplicación",
        }
    }
}

/// Lo que cambia del menú de la bandeja después de crearlo.
struct TrayItems<R: Runtime> {
    shortcut: MenuItem<R>,
    autostart: CheckMenuItem<R>,
}

fn main() {
    tauri::Builder::default()
        // La primera: así una segunda instancia sale antes de crear nada (§17.3).
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if !args.iter().any(|arg| arg == AUTOSTART_ARG) {
                show_main_window(app);
            }
        }))
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .arg(AUTOSTART_ARG)
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed
                        && shortcut.id() == capture_shortcut().id()
                    {
                        toggle_capture(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            let window = create_main_window(app.handle())?;
            let status = register_shortcut(app.handle());
            create_tray(app.handle(), status)?;
            if !launched_by_autostart() {
                show(&window);
            }
            Ok(())
        })
        // Cerrar la ventana (también con Alt+F4) la deja en la bandeja; «Salir» cierra la app.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event
                && window.label() == MAIN_WINDOW
            {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("GameAgenda no ha podido arrancar");
}

fn launched_by_autostart() -> bool {
    std::env::args().skip(1).any(|arg| arg == AUTOSTART_ARG)
}

/// La ventana se crea aquí y no desde `tauri.conf.json` (`"create": false`) para cargar `ga-web`
/// como origen externo y poner los filtros de navegación.
fn create_main_window<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<WebviewWindow<R>> {
    let mut config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == MAIN_WINDOW)
        .cloned()
        .ok_or_else(|| config_error("tauri.conf.json no declara la ventana `main`"))?;
    if tauri::is_dev()
        && let Some(dev_url) = app.config().build.dev_url.clone()
    {
        config.url = WebviewUrl::External(dev_url);
    }
    let WebviewUrl::External(start_url) = &config.url else {
        return Err(config_error(
            "la ventana `main` tiene que cargar una URL https://",
        ));
    };
    let app_url = start_url.clone();

    WebviewWindowBuilder::from_config(app, &config)?
        // Solo el origen de la app; lo demás se abre en el navegador del sistema.
        .on_navigation(move |url| {
            let allowed = same_origin(url, &app_url);
            if !allowed {
                open_in_browser(url);
            }
            allowed
        })
        // `target="_blank"` («Ver en Steam»): al navegador del sistema, nunca otra ventana aquí.
        .on_new_window(|url, _features| {
            open_in_browser(&url);
            NewWindowResponse::Deny
        })
        .build()
}

fn config_error(message: &str) -> tauri::Error {
    tauri::Error::Io(std::io::Error::other(message.to_owned()))
}

fn same_origin(url: &Url, app_url: &Url) -> bool {
    url.origin() == app_url.origin()
}

/// Abre un enlace `https://` en el navegador predeterminado. Lo demás se ignora.
fn open_in_browser(url: &Url) {
    if url.scheme() != "https" {
        return;
    }
    #[cfg(windows)]
    {
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        use windows::core::{HSTRING, PCWSTR, w};

        let target = HSTRING::from(url.as_str());
        // SAFETY: todas las cadenas acaban en NUL y viven hasta que vuelve la llamada; la URL ya
        // está normalizada por `Url` (sin espacios ni comillas) y el esquema es `https`.
        unsafe {
            ShellExecuteW(
                None,
                w!("open"),
                &target,
                PCWSTR::null(),
                PCWSTR::null(),
                SW_SHOWNORMAL,
            );
        }
    }
}

fn register_shortcut<R: Runtime>(app: &AppHandle<R>) -> ShortcutStatus {
    let shortcuts = app.global_shortcut();
    if shortcuts.is_registered(capture_shortcut()) {
        return ShortcutStatus::Ready;
    }
    match shortcuts.register(capture_shortcut()) {
        Ok(()) => ShortcutStatus::Ready,
        Err(_) => ShortcutStatus::Busy,
    }
}

/// El atajo: si la ventana está delante, la oculta; si no, la pone delante con la paleta.
fn toggle_capture<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    if is_in_front(&window) {
        let _ = window.hide();
    } else {
        show(&window);
        // Sin recargar: la página abre la paleta con el foco (§17.3).
        let _ = window.eval(CAPTURE_SCRIPT);
    }
}

fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        show(&window);
    }
}

fn show<R: Runtime>(window: &WebviewWindow<R>) {
    if window.is_minimized().unwrap_or(false) {
        let _ = window.unminimize();
    }
    let _ = window.show();
    let _ = window.set_focus();
}

fn is_in_front<R: Runtime>(window: &WebviewWindow<R>) -> bool {
    window.is_visible().unwrap_or(false)
        && !window.is_minimized().unwrap_or(false)
        && is_foreground(window)
}

/// `is_focused` no vale: el foco del teclado lo tiene la ventana hija de WebView2.
#[cfg(windows)]
fn is_foreground<R: Runtime>(window: &WebviewWindow<R>) -> bool {
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    let Ok(hwnd) = window.hwnd() else {
        return false;
    };
    // SAFETY: `GetForegroundWindow` no recibe argumentos; solo se compara el valor que devuelve.
    unsafe { GetForegroundWindow() == hwnd }
}

#[cfg(not(windows))]
fn is_foreground<R: Runtime>(window: &WebviewWindow<R>) -> bool {
    window.is_focused().unwrap_or(false)
}

fn create_tray<R: Runtime>(app: &AppHandle<R>, status: ShortcutStatus) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, MENU_OPEN, "Abrir", true, None::<&str>)?;
    let shortcut = MenuItem::with_id(
        app,
        MENU_SHORTCUT,
        status.menu_text(),
        status.menu_enabled(),
        None::<&str>,
    )?;
    let autostart = CheckMenuItem::with_id(
        app,
        MENU_AUTOSTART,
        "Iniciar con Windows",
        true,
        app.autolaunch().is_enabled().unwrap_or(false),
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Salir", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &PredefinedMenuItem::separator(app)?,
            &shortcut,
            &PredefinedMenuItem::separator(app)?,
            &autostart,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    app.manage(TrayItems {
        shortcut,
        autostart,
    });

    let mut tray = TrayIconBuilder::with_id(TRAY_ICON)
        .tooltip(status.tooltip())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(on_menu_event)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

fn on_menu_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    match event.id().as_ref() {
        MENU_OPEN => show_main_window(app),
        MENU_SHORTCUT => {
            let status = register_shortcut(app);
            set_shortcut_status(app, status);
        }
        MENU_AUTOSTART => toggle_autostart(app),
        MENU_QUIT => app.exit(0),
        _ => {}
    }
}

fn set_shortcut_status<R: Runtime>(app: &AppHandle<R>, status: ShortcutStatus) {
    if let Some(items) = app.try_state::<TrayItems<R>>() {
        let _ = items.shortcut.set_text(status.menu_text());
        let _ = items.shortcut.set_enabled(status.menu_enabled());
    }
    if let Some(tray) = app.tray_by_id(TRAY_ICON) {
        let _ = tray.set_tooltip(Some(status.tooltip()));
    }
}

/// Windows ya ha cambiado la marca al pulsar: se aplica y luego se deja como esté de verdad.
fn toggle_autostart<R: Runtime>(app: &AppHandle<R>) {
    let Some(items) = app.try_state::<TrayItems<R>>() else {
        return;
    };
    let manager = app.autolaunch();
    let wanted = items.autostart.is_checked().unwrap_or(false);
    let _ = if wanted {
        manager.enable()
    } else {
        manager.disable()
    };
    let _ = items
        .autostart
        .set_checked(manager.is_enabled().unwrap_or(false));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_capture_script_dispatches_the_fixed_event() {
        assert_eq!(
            CAPTURE_SCRIPT,
            "window.dispatchEvent(new Event('gameagenda:capture'));"
        );
    }

    #[test]
    fn the_shortcut_is_ctrl_shift_space() {
        let expected: Shortcut = "Control+Shift+Space".parse().unwrap();
        assert_eq!(capture_shortcut().id(), expected.id());
    }

    #[test]
    fn a_busy_shortcut_says_so_and_can_be_retried() {
        assert!(!ShortcutStatus::Ready.menu_enabled());
        assert!(ShortcutStatus::Busy.menu_enabled());
        assert!(ShortcutStatus::Busy.menu_text().contains("otra aplicación"));
        assert!(ShortcutStatus::Busy.tooltip().contains("otra aplicación"));
        assert!(
            ShortcutStatus::Ready
                .menu_text()
                .contains("Ctrl+Mayús+Espacio")
        );
    }

    #[test]
    fn only_the_app_origin_stays_in_the_window() {
        let app: Url = "https://ga-web.gameagenda.workers.dev/".parse().unwrap();
        let same: Url = "https://ga-web.gameagenda.workers.dev/apuntar?x=1"
            .parse()
            .unwrap();
        let steam: Url = "https://store.steampowered.com/app/730/".parse().unwrap();
        let http: Url = "http://ga-web.gameagenda.workers.dev/".parse().unwrap();
        let lookalike: Url = "https://ga-web.gameagenda.workers.dev.evil.example/"
            .parse()
            .unwrap();
        assert!(same_origin(&same, &app));
        assert!(!same_origin(&steam, &app));
        assert!(!same_origin(&http, &app));
        assert!(!same_origin(&lookalike, &app));
    }
}
