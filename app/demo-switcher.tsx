import "./demo-switcher.css";
import type { ReactNode } from "react";

export type WebMcpStatus = "checking" | "connected" | "preview";
type DemoSwitcherProps = { active: "reports" | "builder" | "store"; children?: ReactNode };

export function webMcpStatusLabel(status: WebMcpStatus) {
  return status === "connected" ? "WebMCP connected" : status === "preview" ? "WebMCP preview" : "WebMCP connecting";
}

const demos = [
  {
    id: "store" as const,
    href: "/store",
    number: "01",
    title: "A Personal Store",
    description: "Let your intent reshape how a catalog is browsed",
  },
  {
    id: "builder" as const,
    href: "/builder",
    number: "02",
    title: "A Personal Homepage",
    description: "Create an entire personal dashboard, tailored to your role",
  },
  {
    id: "reports" as const,
    href: "/",
    number: "03",
    title: "Distributing Personal Components",
    description: "See how a familiar component can be transformed around you",
  },
];

export default function DemoSwitcher({ active, children }: DemoSwitcherProps) {
  return <nav className="demo-switcher" aria-label="A Personal Internet demos">
    <div className={`demo-switcher-inner${children ? " has-detail" : ""}`}>
      <div className="demo-switcher-brand">
        <span>A Personal Internet</span>
        <small>See how AI rewrites what it means to be <em>yours</em>.</small>
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
