"use client";

import { useState } from "react";
import "./audience-onboarding.css";

type AudienceOnboardingProps = {
  initialFirstName: string;
  initialJobRole: string;
  canCancel: boolean;
  onSave: (firstName: string, jobRole: string) => void;
  onCancel?: () => void;
};

function timeGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function AudienceOnboarding({ initialFirstName, initialJobRole, canCancel, onSave, onCancel }: AudienceOnboardingProps) {
  const [firstName, setFirstName] = useState(initialFirstName);
  const [jobRole, setJobRole] = useState(initialJobRole);
  const previewName = firstName.trim() || "there";

  return (
    <div className="audience-onboarding">
      <section className="audience-brief" aria-labelledby="audience-brief-title">
        <div>
          <p className="audience-step">Step 1 of 2 · Audience</p>
          <h3 id="audience-brief-title">First, tell the composer who this page is for.</h3>
          <p>WebMCP uses two small details to decide what deserves attention, how to explain it, and which next action will be most useful.</p>
        </div>
        <div className="audience-example" aria-label="Personalization preview">
          <span>Personalization preview</span>
          <strong>{timeGreeting()}, {previewName}.</strong>
          <p>{jobRole.trim() ? `Your ${jobRole.trim()} view will prioritize the signals and decisions most relevant to your work.` : "Your role will shape the page’s priorities and call to action."}</p>
        </div>
        <ul className="audience-reasons">
          <li><span>01</span><div><strong>Priority</strong><p>Choose the most relevant reports and ordering.</p></div></li>
          <li><span>02</span><div><strong>Language</strong><p>Use terms and context that fit your work.</p></div></li>
          <li><span>03</span><div><strong>Action</strong><p>End with a useful, role-aware next step.</p></div></li>
        </ul>
      </section>

      <form className="audience-form" onSubmit={(event) => { event.preventDefault(); const name = firstName.trim(); const role = jobRole.trim(); if (name && role) onSave(name, role); }}>
        <div>
          <p className="eyebrow"><span /> Audience brief</p>
          <h3>Make this page yours</h3>
          <p>We won’t guess. Confirm these details before WebMCP composes the page.</p>
        </div>
        <label>
          <span>First name</span>
          <input autoFocus required autoComplete="given-name" maxLength={60} value={firstName} onChange={(event) => setFirstName(event.target.value)} placeholder="Aaron" />
        </label>
        <label>
          <span>Job role</span>
          <input required autoComplete="organization-title" maxLength={100} value={jobRole} onChange={(event) => setJobRole(event.target.value)} placeholder="Product manager" />
        </label>
        <p className="audience-privacy"><span aria-hidden="true">⌂</span> Kept only in this browser. It personalizes presentation, not the underlying catalog data.</p>
        <div className="audience-form-actions">
          {canCancel ? <button type="button" className="audience-cancel" onClick={onCancel}>Keep current audience</button> : null}
          <button type="submit" className="audience-continue" disabled={!firstName.trim() || !jobRole.trim()}>Continue to page builder <span aria-hidden="true">→</span></button>
        </div>
      </form>
    </div>
  );
}
