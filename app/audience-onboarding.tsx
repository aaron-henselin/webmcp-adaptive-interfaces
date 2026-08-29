"use client";

import { useEffect, useId, useState } from "react";
import { searchGameCompanies, type GameCompany } from "./catalog-data";
import type { AudienceCompany } from "./workspace-model";
import "./audience-onboarding.css";

type AudienceOnboardingProps = {
  initialFirstName: string;
  initialJobRole: string;
  initialCompany: AudienceCompany | null;
  canCancel: boolean;
  onSave: (firstName: string, jobRole: string, company: AudienceCompany) => void;
  onCancel?: () => void;
};

function timeGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function companyRole(company: GameCompany) {
  if (company.roles.length === 2) return "developer & publisher";
  return company.roles[0] ?? "catalog company";
}

export default function AudienceOnboarding({ initialFirstName, initialJobRole, initialCompany, canCancel, onSave, onCancel }: AudienceOnboardingProps) {
  const [firstName, setFirstName] = useState(initialFirstName);
  const [jobRole, setJobRole] = useState(initialJobRole);
  const [companyQuery, setCompanyQuery] = useState(initialCompany?.name ?? "");
  const [company, setCompany] = useState<AudienceCompany | null>(initialCompany);
  const [companyOptions, setCompanyOptions] = useState<GameCompany[]>([]);
  const [companyStatus, setCompanyStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [activeOption, setActiveOption] = useState(0);
  const listboxId = useId();
  const previewName = firstName.trim() || "there";

  useEffect(() => {
    const query = companyQuery.trim();
    if (company?.name === query || query.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setCompanyStatus("loading");
      searchGameCompanies(query, controller.signal)
        .then((results) => { setCompanyOptions(results); setActiveOption(0); setCompanyStatus("ready"); })
        .catch(() => { if (!controller.signal.aborted) { setCompanyOptions([]); setCompanyStatus("error"); } });
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [company, companyQuery]);

  const chooseCompany = (selected: GameCompany) => {
    setCompany({ id: selected.id, name: selected.name });
    setCompanyQuery(selected.name);
    setCompanyOptions([]);
    setCompanyStatus("idle");
  };
  const showCompanyOptions = !company && companyQuery.trim().length >= 2 && (companyStatus !== "idle" || companyOptions.length > 0);
  const ready = Boolean(firstName.trim() && jobRole.trim() && company);

  return (
    <div className="audience-onboarding">
      <section className="audience-brief" aria-labelledby="audience-brief-title">
        <div>
          <h3 id="audience-brief-title">Your company dashboard is almost ready.</h3>
          <p className="audience-intro">The following demo will create a personal company dashboard. Personalization is stored within your browser and not sent to the server. Have fun!</p>
          <div className="audience-ideas" aria-label="Ideas to try in the demo">
            <div>
              <span>Role ideas</span>
              <ul><li>Product manager</li><li>Publishing lead</li><li>Market analyst</li></ul>
            </div>
            <div>
              <span>Company ideas</span>
              <ul><li>Valve</li><li>Capcom</li><li>Devolver Digital</li></ul>
            </div>
          </div>
        </div>
        <div className="audience-example" aria-label="Personalization preview">
          <span>Personalization preview</span>
          <strong>{timeGreeting()}, {previewName}.</strong>
          <p>{jobRole.trim() && company ? `Your ${jobRole.trim()} view for ${company.name} will prioritize the market signals and decisions most relevant to your work.` : "Your role and company will shape the page’s priorities, comparisons, and call to action."}</p>
        </div>
      </section>

      <form className="audience-form" onSubmit={(event) => { event.preventDefault(); if (ready && company) onSave(firstName.trim(), jobRole.trim(), company); }}>
        <div>
          <p className="eyebrow"><span /> Audience brief</p>
          <h3>Make this page yours</h3>
          <p>We won’t guess. Confirm all three details before WebMCP composes the page.</p>
        </div>
        <label>
          <span>First name</span>
          <input autoFocus required autoComplete="given-name" maxLength={60} value={firstName} onChange={(event) => setFirstName(event.target.value)} placeholder="Aaron" />
        </label>
        <label>
          <span>Job role</span>
          <input required autoComplete="organization-title" maxLength={100} value={jobRole} onChange={(event) => setJobRole(event.target.value)} placeholder="Product manager" />
        </label>
        <div className="company-field">
          <label htmlFor="audience-company">Game company</label>
          <p>Search the Steam catalog, then select the closest match yourself.</p>
          <div className="company-combobox">
            <input
              id="audience-company"
              required
              autoComplete="organization"
              maxLength={120}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={showCompanyOptions}
              aria-controls={listboxId}
              aria-activedescendant={showCompanyOptions && companyOptions[activeOption] ? `${listboxId}-${companyOptions[activeOption].id}` : undefined}
              value={companyQuery}
              onChange={(event) => { setCompanyQuery(event.target.value); setCompany(null); setCompanyOptions([]); setCompanyStatus("idle"); setActiveOption(0); }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" && companyOptions.length) { event.preventDefault(); setActiveOption((value) => Math.min(companyOptions.length - 1, value + 1)); }
                if (event.key === "ArrowUp" && companyOptions.length) { event.preventDefault(); setActiveOption((value) => Math.max(0, value - 1)); }
                if (event.key === "Enter" && showCompanyOptions && companyOptions[activeOption]) { event.preventDefault(); chooseCompany(companyOptions[activeOption]); }
                if (event.key === "Escape") { setCompanyOptions([]); setCompanyStatus("idle"); }
              }}
              placeholder="Search developers and publishers"
            />
            {company ? <span className="company-confirmed" aria-label="Company selected">✓</span> : null}
            {showCompanyOptions ? <div className="company-options" id={listboxId} role="listbox" aria-label="Matching game companies">
              {companyStatus === "loading" ? <p className="company-option-status">Searching catalog…</p> : null}
              {companyStatus === "error" ? <p className="company-option-status error">Company search is unavailable. Try again.</p> : null}
              {companyStatus === "ready" && !companyOptions.length ? <p className="company-option-status">No matching catalog companies. Try a broader name.</p> : null}
              {companyOptions.map((option, index) => <button
                id={`${listboxId}-${option.id}`}
                type="button"
                role="option"
                aria-selected={index === activeOption}
                className={index === activeOption ? "active" : ""}
                key={option.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => chooseCompany(option)}
              ><span><strong>{option.name}</strong><small>{companyRole(option)} · {option.gameCount.toLocaleString()} catalog {option.gameCount === 1 ? "game" : "games"}</small></span><b aria-hidden="true">Select</b></button>)}
            </div> : null}
          </div>
        </div>
        <p className="audience-privacy"><span aria-hidden="true">⌂</span> Kept only in this browser. It personalizes presentation, not the underlying catalog data.</p>
        <div className="audience-form-actions">
          {canCancel ? <button type="button" className="audience-cancel" onClick={onCancel}>Keep current audience</button> : null}
          <button type="submit" className="audience-continue" disabled={!ready}>Continue to page builder <span aria-hidden="true">→</span></button>
        </div>
      </form>
    </div>
  );
}
