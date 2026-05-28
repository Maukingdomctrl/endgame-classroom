import type { FallbackProps } from "react-error-boundary";

export default function RootErrorFallback({ error }: FallbackProps) {
  const message = error instanceof Error ? error.message : String(error);

  return (
    <div
      style={{
        padding: "40px",
        fontFamily: "system-ui, sans-serif",
        backgroundColor: "#fff5f5",
        color: "#c53030",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        style={{
          maxWidth: "600px",
          backgroundColor: "#fff",
          padding: "30px",
          borderRadius: "8px",
          boxShadow: "0 4px 6px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0, 0, 0, 0.1)",
          borderLeft: "6px solid #e53e3e",
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: "24px", color: "#9b2c2c" }}>
          Initialization Error
        </h2>

        <p style={{ color: "#4a5568", fontSize: "16px", lineHeight: "1.5" }}>
          The application crashed during its initial layout setup phase. This usually happens
          when code inside your main <code>App</code> component attempts to read properties
          from an uninitialized or <code>undefined</code> object during render.
        </p>

        <hr style={{ border: "0", borderTop: "1px solid #fed7d7", margin: "20px 0" }} />

        <p
          style={{
            fontWeight: "bold",
            marginBottom: "8px",
            fontSize: "14px",
            textTransform: "uppercase",
            color: "#e53e3e",
          }}
        >
          Error Details:
        </p>

        <pre
          style={{
            backgroundColor: "#f7fafc",
            padding: "15px",
            borderRadius: "6px",
            overflowX: "auto",
            fontFamily: "monospace",
            fontSize: "14px",
            border: "1px solid #e2e8f0",
            color: "#2d3748",
            margin: 0,
          }}
        >
          {message}
        </pre>
      </div>
    </div>
  );
}
