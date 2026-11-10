import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./globals.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("root element not found");
}

document.documentElement.dataset.theme = localStorage.getItem("kpeg.theme") ?? "dark";

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
