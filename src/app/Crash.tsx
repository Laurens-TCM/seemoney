// Shows what went wrong instead of a blank page if the app throws while rendering.
import { Component, type ReactNode } from 'react';

export class Crash extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="signin">
        <div className="panel stack">
          <h1>Something went wrong</h1>
          <p>See The Money hit an error it couldn't recover from. Reloading usually fixes it.</p>
          <p className="small muted">{this.state.error.message}</p>
          <button type="button" className="primary" onClick={() => location.reload()}>Reload</button>
        </div>
      </main>
    );
  }
}
