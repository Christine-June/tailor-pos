import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Provider } from "react-redux"

import App from "./App"
import { initStore } from "./store"
import "./index.css"

// Load the saved session, cart and outbox from this device before the first render.
void initStore().then((store) => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Provider store={store}>
        <App />
      </Provider>
    </StrictMode>,
  )
})

// The service worker lets the app open with no internet. Dev mode skips it so code reloads stay live.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("Offline support unavailable", err))
  })
}
