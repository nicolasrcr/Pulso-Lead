import { createRoot } from "react-dom/client";
import { tokens, toCssVariables } from "@pulso/ui";
import { App } from "./App";

const style = document.createElement("style");
style.textContent = toCssVariables(tokens);
document.head.appendChild(style);
createRoot(document.getElementById("root")!).render(<App />);
