import { useState } from 'react'
import { createRoot } from 'react-dom/client'
function App() { const [n, setN] = useState(0); return <button onClick={() => setN(n + 1)}>{n}</button> }
createRoot(document.getElementById('root')).render(<App />)
