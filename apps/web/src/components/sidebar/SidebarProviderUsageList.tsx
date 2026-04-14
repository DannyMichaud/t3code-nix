import type { ProviderKind, ServerProvider } from "@t3tools/contracts";

import {
  getSidebarProviderUsageEntries,
  type SidebarProviderUsageEntry,
} from "~/lib/providerUsage";
import { ClaudeAI, OpenAI } from "../Icons";
import { UsageLimitsPills } from "../chat/UsageLimitsWidget";
import { cn } from "~/lib/utils";

function providerLabel(provider: ProviderKind): string {
  switch (provider) {
    case "claudeAgent":
      return "Claude";
    case "codex":
      return "Codex";
  }
}

function providerIcon(provider: ProviderKind) {
  return provider === "claudeAgent" ? ClaudeAI : OpenAI;
}

function providerIconClassName(provider: ProviderKind): string {
  return provider === "claudeAgent" ? "text-[#d97757]" : "text-muted-foreground/70";
}

function SidebarProviderUsageRow(props: { entry: SidebarProviderUsageEntry }) {
  const Icon = providerIcon(props.entry.provider);

  return (
    <div
      data-testid={`sidebar-provider-usage-row-${props.entry.provider}`}
      className="flex w-full flex-col gap-1.5 rounded-md border border-sidebar-border/70 px-2 py-1.5"
    >
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-sidebar-foreground/75">
        <Icon
          aria-hidden="true"
          className={cn("size-3.5 shrink-0", providerIconClassName(props.entry.provider))}
        />
        <span>{providerLabel(props.entry.provider)}</span>
      </div>
      <UsageLimitsPills
        windows={props.entry.windows}
        dataTestId={`sidebar-provider-usage-widget-${props.entry.provider}`}
        triggerClassName="flex w-full flex-wrap items-center gap-1"
        popupAlign="start"
      />
    </div>
  );
}

export function SidebarProviderUsageList(props: { providers: ReadonlyArray<ServerProvider> }) {
  const usageEntries = getSidebarProviderUsageEntries(props.providers);
  if (usageEntries.length === 0) {
    return null;
  }

  return (
    <div data-testid="sidebar-provider-usage-list" className="flex flex-col gap-2">
      {usageEntries.map((entry) => (
        <SidebarProviderUsageRow key={entry.provider} entry={entry} />
      ))}
    </div>
  );
}
