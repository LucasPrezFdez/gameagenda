// Los textos de las cuentas (ADR-014), en el *chunk* de Ajustes y no en `i18n/es.ts`, que va en
// el inicial (con ellos, el JS inicial subía 1,4 KB). Los que comparten con la sincronización (la
// edad, «Cancelar») siguen en `es.syncPanel`. La contraseña nunca sale del dispositivo, y no se
// envían correos.

export const accountTexts = {
  accountTitle: 'Tu cuenta',
  accountIntro:
    'Con una cuenta, tus juegos se guardan fuera de este dispositivo y los tienes en el móvil y en el PC. Se sincroniza sola, también cuando vuelve la conexión. La app funciona igual sin cuenta.',
  accountModes: 'Iniciar sesión o crear una cuenta',
  logInTab: 'Iniciar sesión',
  signUpTab: 'Crear cuenta',
  email: 'Email',
  password: 'Contraseña',
  newPassword: 'Contraseña nueva',
  passwordHint: (min: number) =>
    `Al menos ${min} caracteres, sin más reglas. Una frase de varias palabras se recuerda bien y es difícil de adivinar.`,
  showPassword: 'Mostrar la contraseña',
  /** Lo que se ve en el botón; el nombre accesible es `showPassword`. */
  show: 'Mostrar',
  logIn: 'Iniciar sesión',
  /** Mientras el dispositivo calcula la clave (PBKDF2, ≈1 s) y espera al servidor. */
  loggingIn: 'Comprobando…',
  signUp: 'Crear cuenta',
  signingUp: 'Creando la cuenta…',
  logInJoins: 'Si este dispositivo ya tiene juegos apuntados, se juntan con los de tu cuenta.',
  signUpStored:
    'No guardamos tu email ni tu contraseña: solo una huella de cada uno, que sirve para comprobarlos pero no para leerlos. La contraseña ni siquiera sale de este dispositivo. No enviamos correos, así que tampoco comprobamos que el email sea tuyo.',
  forgot: 'He olvidado mi contraseña',
  forgotHelp:
    'Como no enviamos correos, no podemos recuperarla por email. Entra con una llave de acceso o con tu código de recuperación, en «Otras formas de entrar», y después cámbiala aquí, en «Tu cuenta».',
  emailMissing: 'Escribe tu email.',
  emailInvalid: 'Este email no parece válido. Revisa que tenga una @ y ningún espacio.',
  passwordMissing: 'Escribe tu contraseña.',
  passwordTooShort: (min: number) => `La contraseña necesita al menos ${min} caracteres.`,
  passwordTooLong: (max: number) => `La contraseña puede tener como mucho ${max} caracteres.`,
  passwordSameAsEmail: 'La contraseña no puede ser tu email.',
  logInAgainTitle: 'Volver a iniciar sesión',
  logInAgainIntro: 'Si tu cuenta tiene email y contraseña, entra con ellos.',
  otherWaysTitle: 'Otras formas de entrar',
  otherWaysIntro:
    'Con un código de otro dispositivo, tu código de recuperación o una llave de acceso. También puedes sincronizar sin email.',
  loggedIn: 'Has iniciado sesión. Estamos trayendo tu agenda.',

  // Con sesión: lo que tiene la cuenta.
  accountLoading: 'Cargando tu cuenta…',
  accountRetry: 'Volver a cargar',
  accountAs: (email: string) => `Has iniciado sesión como ${email}.`,
  accountWithLogin: 'Tu cuenta tiene email y contraseña.',
  accountWithoutLogin:
    'Tu cuenta no tiene email ni contraseña: entras en otros dispositivos con un código o una llave de acceso.',
  addLogin: 'Añadir email y contraseña',
  changePassword: 'Cambiar la contraseña',
  changeEmail: 'Cambiar el email',
  changeEmailHint:
    'Escribe también la contraseña: la que tienes o una nueva. Hace falta para guardar el email.',
  saveLogin: 'Guardar',
  savingLogin: 'Guardando…',
  loginSaved: 'Hemos guardado tu email y tu contraseña. Los demás dispositivos siguen dentro.',
  removeLoginTitle: 'Quitar el email y la contraseña',
  removeLoginIntro:
    'Tu cuenta sigue, con sus dispositivos, sus llaves y su código de recuperación, pero ya no se podrá entrar con el email.',
  removeLoginConfirm: '¿Quitar el email y la contraseña de tu cuenta?',
  removeLoginDo: 'Quitar',
  removingLogin: 'Quitando…',
  loginRemoved: 'Hemos quitado el email y la contraseña de tu cuenta.',
  errors: {
    invalidLogin: 'El email o la contraseña no son correctos.',
    emailTaken:
      'Ese email ya tiene una cuenta. Inicia sesión con él, o usa otro. No enviamos correos, así que no podemos comprobar de quién es.',
    tooManyAttempts:
      'Demasiados intentos con este email. Vuelve a probar dentro de una hora, o entra con una llave de acceso o tu código de recuperación.',
    accountsDisabled:
      'Las cuentas con email no están disponibles ahora mismo. Puedes entrar con un código o una llave de acceso, o sincronizar sin email.',
  },
} as const;
