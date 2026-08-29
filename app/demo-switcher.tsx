import "./demo-switcher.css";
import type { ReactNode } from "react";

export type WebMcpStatus = "checking" | "connected" | "preview";
type DemoSwitcherProps = { active: "reports" | "builder"; status: WebMcpStatus; children?: ReactNode };

const demos = [
  {
    id: "reports" as const,
    href: "/",
    number: "01",
    title: "Report library",
    description: "Grid, saved reports, one active result",
  },
  {
    id: "builder" as const,
    href: "/builder",
    number: "02",
    title: "Page builder",
    description: "Slots, tabs, widgets, drag-and-drop",
  },
];

export default function DemoSwitcher({ active, status, children }: DemoSwitcherProps) {
  return <nav className="demo-switcher" aria-label="Steam Desk demos">
    <div className={`demo-switcher-inner${children ? " has-detail" : ""}`}>
      <div className="demo-switcher-brand">
        <span>Steam Desk</span>
        <small className={`demo-webmcp-status webmcp-status-${status}`}>{status === "connected" ? "WebMCP connected" : status === "preview" ? "WebMCP preview" : "Connecting to your browser"}</small>
      </div>
      <div className="demo-switcher-options">
        {demos.map((demo) => <a
          key={demo.id}
          href={demo.href}
          className={active === demo.id ? "active" : ""}
          aria-current={active === demo.id ? "page" : undefined}
        >
          <span className="demo-number">{demo.number}</span>
          <span className="demo-name"><strong>{demo.title}</strong><small>{demo.description}</small></span>
          <span className="demo-arrow" aria-hidden="true">↗</span>
        </a>)}
      </div>
      {children ? <div className="demo-switcher-detail">{children}</div> : null}
    </div>
  </nav>;
}
