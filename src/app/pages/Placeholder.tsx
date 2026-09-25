// Screens built in later phases.
export function Placeholder({ title, phase, children }: { title: string; phase: number; children?: string }) {
  return (
    <>
      <h1>{title}</h1>
      <div className="panel">
        <p>{children}</p>
        <p className="muted small" style={{ margin: 0 }}>Coming in phase {phase}.</p>
      </div>
    </>
  );
}
