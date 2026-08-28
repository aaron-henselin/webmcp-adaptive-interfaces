import DemoSwitcher from "../demo-switcher";
import WorkspacePage from "../workspace-page";

export default function BuilderDemoPage() {
  return <div className="demo-host builder-demo-host">
    <DemoSwitcher active="builder" />
    <WorkspacePage />
  </div>;
}
