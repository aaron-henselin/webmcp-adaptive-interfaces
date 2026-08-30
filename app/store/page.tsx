"use client";

import { useState } from "react";
import type { WebMcpStatus } from "../demo-switcher";
import StorefrontPage from "../storefront-page";

export default function StorefrontDemoPage() {
  const [webMcpStatus, setWebMcpStatus] = useState<WebMcpStatus>("checking");
  return <div className="demo-host storefront-demo-host">
    <StorefrontPage webMcpStatus={webMcpStatus} onWebMcpStatusChange={setWebMcpStatus} />
  </div>;
}