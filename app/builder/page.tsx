"use client";

import { useState } from "react";
import type { WebMcpStatus } from "../demo-switcher";
import WorkspacePage from "../workspace-page";

export default function BuilderDemoPage() {
  const [, setWebMcpStatus] = useState<WebMcpStatus>("checking");
  return <div className="demo-host builder-demo-host">
    <WorkspacePage onWebMcpStatusChange={setWebMcpStatus} />
  </div>;
}
