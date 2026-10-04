import { Component, type ReactNode } from "react";

type ErrorBoundaryProps = { children: ReactNode };
type ErrorBoundaryState = { error: Error | null };

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("界面渲染异常", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-boundary">
        <h1>界面出现异常</h1>
        <p>{this.state.error.message}</p>
        <div>
          <button onClick={() => this.setState({ error: null })}>重试渲染</button>
          <button onClick={() => window.location.reload()}>重新加载</button>
        </div>
      </div>
    );
  }
}
