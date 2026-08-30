"use client";

import { useState } from "react";
import type { WebMcpStatus } from "./demo-switcher";
import type { AudienceContext, OnboardingStage } from "./workspace-model";
import "./audience-onboarding.css";

type AudienceOnboardingProps = {
  stage: OnboardingStage;
  audience: AudienceContext;
  connectionStatus: WebMcpStatus;
  canCancel: boolean;
  onCancel?: () => void;
};

function ConnectionSignal({ unavailable = false }: { unavailable?: boolean }) {
  return <div className={`audience-connection-signal${unavailable ? " is-unavailable" : ""}`} aria-hidden="true">
    <span className="audience-connection-node node-browser" />
    <span className="audience-connection-path"><i /></span>
    <span className="audience-connection-node node-agent" />
  </div>;
}

function timeGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function AudienceOnboarding({ stage, audience, connectionStatus, canCancel, onCancel }: AudienceOnboardingProps) {
  const [copied, setCopied] = useState(false);
  const audienceReady = Boolean(audience.firstName && audience.jobRole && audience.company);
  const proposalRequired = stage === "proposal_required" && audienceReady;
  const prompt = audienceReady ? "Update my Steam Desk audience." : "Set up my Steam Desk audience.";

  const copyPrompt = () => {
    void navigator.clipboard.writeText(prompt).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  };

  if (stage === "audience_required" && !audienceReady) {
    return <div className="audience-onboarding audience-invitation">
      {connectionStatus === "checking" ? <section className="audience-connecting" role="status" aria-live="polite" aria-labelledby="audience-brief-title">
        <ConnectionSignal />
        <p id="audience-brief-title">Connecting…</p>
      </section> : connectionStatus === "preview" ? <section className="audience-unavailable" role="status" aria-labelledby="audience-brief-title">
        <ConnectionSignal unavailable />
        <div>
          <h3 id="audience-brief-title">WebMCP isn’t available.</h3>
          <p>Open this page in a browser with WebMCP support to start onboarding.</p>
        </div>
      </section> : <section className="audience-invitation-copy" aria-labelledby="audience-brief-title">
        <h3 id="audience-brief-title">Make this page yours.</h3>
        <p>Say <strong>“onboard me”</strong> to get started.</p>
      </section>}
    </div>;
  }

  return (
    <div className="audience-onboarding">
      <section className="audience-brief" aria-labelledby="audience-brief-title">
        <div>
          <p className="eyebrow"><span /> Agent-led setup</p>
          <h3 id="audience-brief-title">{proposalRequired ? "Your audience is ready. The useful part comes next." : "Set up the dashboard in conversation."}</h3>
          <p className="audience-intro">{proposalRequired
            ? "WebMCP now has the context it needs. Before anything is added to the page, the agent will propose the most useful briefing for this role and company and wait for your approval."
            : "Ask WebMCP to begin onboarding. It will run a short survey for your name, company, and role, resolve likely company typos, and keep the confirmed audience in this browser."}</p>
        </div>
        <div className="audience-flow" aria-label="Agent onboarding workflow">
          <span className={audienceReady ? "complete" : "active"}><b>1</b> Survey</span>
          <i aria-hidden="true">→</i>
          <span className={proposalRequired ? "active" : audienceReady ? "complete" : ""}><b>2</b> Proposal</span>
          <i aria-hidden="true">→</i>
          <span><b>3</b> Compose</span>
        </div>
      </section>

      <section className="audience-agent-card" aria-live="polite">
        <div>
          <p className="eyebrow"><span /> {proposalRequired ? "Proposal required" : "Audience survey"}</p>
          <h3>{proposalRequired ? `${timeGreeting()}, ${audience.firstName}.` : "Let the agent ask the questions"}</h3>
          <p>{proposalRequired
            ? `Your ${audience.jobRole} view for ${audience.company?.name} is saved. The agent should recommend a purpose, the strongest signals, a clear structure, and one next action before requesting page composition.`
            : "The onboarding tool directs the agent to ask for all three details together. You can answer naturally; there is no form to keep in sync."}</p>
        </div>

        {audienceReady ? <dl className="audience-confirmed-list">
          <div><dt>Name</dt><dd>{audience.firstName}</dd></div>
          <div><dt>Company</dt><dd>{audience.company?.name}</dd></div>
          <div><dt>Role</dt><dd>{audience.jobRole}</dd></div>
        </dl> : <div className="audience-survey-preview">
          <span>Name</span><span>Company</span><span>Role</span>
        </div>}

        <p className="audience-privacy"><span aria-hidden="true">⌂</span> Stored only in this browser. Company matching uses the public Steam catalog and does not verify identity.</p>
        <div className="audience-form-actions">
          {canCancel ? <button type="button" className="audience-cancel" onClick={onCancel}>Keep current audience</button> : null}
          {!proposalRequired ? <button type="button" className="audience-continue" onClick={copyPrompt}>{copied ? "Prompt copied ✓" : "Copy setup prompt"}<span aria-hidden="true">↗</span></button> : <span className="audience-waiting">Waiting for the agent’s proposal</span>}
        </div>
      </section>
    </div>
  );
}
