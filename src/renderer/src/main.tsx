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
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import './styles/app.css'
import './styles/redesign20.css'

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
