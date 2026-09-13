import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import { App } from "./App";

const element = document.getElementById("root");
if (!element) throw new Error("Application root is missing");
ReactDOM.createRoot(element).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
