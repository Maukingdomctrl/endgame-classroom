import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import { ErrorBoundary } from "react-error-boundary";
import RootErrorFallback from "./components/RootErrorFallback";
import { loadAllModules } from "./modules/moduleLoader"; // Adjust path if necessary

const rootElement = document.getElementById("root")!;
const root = ReactDOM.createRoot(rootElement);

// Change 2: Render a minimal loading state immediately using the app's dark theme colors
root.render(
  <div
    style={{
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      height: "100vh",
      background: "#14110e",
      color: "#d9cb9e",
      fontFamily: "Georgia, serif",
      fontSize: "16px",
      letterSpacing: "1px",
    }}
  >
    Loading lessons...
  </div>
);

// Change 1: Async IIFE to fetch lessons before the main app mounts
(async () => {
  try {
    // Wait for the sync server to supply the PGNs and populate the cache
    await loadAllModules();
  } catch (error) {
    console.error("Failed to load modules during initialization:", error);
  }

  // Once loaded, render the actual application over the loading screen
  root.render(
    <React.StrictMode>
      <ErrorBoundary FallbackComponent={RootErrorFallback}>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
})();