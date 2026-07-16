import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { bindMainEvents } from './ipc/bindEvents'
import {
  useChatsStore,
  useKeysStore,
  useSettingsStore,
  useVoicesLocalStore
} from './stores/appStore'
import './styles/app.css'

bindMainEvents()
void useSettingsStore.getState().load()
void useKeysStore.getState().load()
void useChatsStore.getState().loadList()
void useVoicesLocalStore.getState().load()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
