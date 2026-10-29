import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Dexie from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { useVirtualizer } from '@tanstack/react-virtual'
const db = new Dexie('ga'); db.version(1).stores({ entries: 'id, status, updatedAt', outbox: 'opId, entryId' })
function List() {
  const items = useLiveQuery(() => db.entries.orderBy('updatedAt').toArray(), []) || []
  const parent = useRef(null)
  const v = useVirtualizer({ count: items.length, getScrollElement: () => parent.current, estimateSize: () => 56 })
  return <div ref={parent} style={{ height: 400, overflow: 'auto' }}><div style={{ height: v.getTotalSize(), position: 'relative' }}>
    {v.getVirtualItems().map(r => <div key={r.key} style={{ position: 'absolute', top: r.start, height: r.size }}>{items[r.index].title}</div>)}</div></div>
}
function App() { const [q, setQ] = useState(''); return <main><input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') db.entries.put({ id: 'manual:' + crypto.randomUUID(), title: q, status: 'want_to_play', updatedAt: Date.now() }) }} /><List /></main> }
createRoot(document.getElementById('root')).render(<App />)
