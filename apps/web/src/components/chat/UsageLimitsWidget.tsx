import type { ServerProvider } from "@t3tools/contracts";

import { getCanonicalProviderUsageWindows } from "~/lib/providerUsage";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";

function formatUsedPercent(value: number): string {
  return `${Math.round(value)}%`;
}

export function UsageLimitsWidget(props: {
  usageLimits: ServerProvider["usageLimits"] | null | undefined;
}) {
  const windows = getCanonicalProviderUsageWindows(props.usageLimits);
  if (windows.length === 0) {
    return null;
  }

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={0}
        render={
          <button
            type="button"
            data-testid="usage-limits-widget"
            className="inline-flex items-center gap-1"
            aria-label={`Usage limits ${windows
              .map((window) => `${window.label} ${formatUsedPercent(window.usedPercent)}`)
              .join(", ")}`}
          >
            {windows.map((window) => (
              <span
                key={window.label}
                data-testid={`usage-limit-pill-${window.label}`}
                className="relative inline-flex min-w-[3.75rem] overflow-hidden rounded-full border border-border/60 bg-muted/35 px-2.5 py-1 text-[11px] font-medium tracking-[0.02em] text-foreground transition-opacity hover:opacity-90"
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 left-0 bg-muted-foreground/14"
                  style={{
                    width: `${Math.max(0, Math.min(100, window.usedPercent))}%`,
                  }}
                />
                <span className="relative flex w-full items-center justify-between gap-1.5">
                  <span className="text-muted-foreground">{window.label}</span>
                  <span>{formatUsedPercent(window.usedPercent)}</span>
                </span>
              </span>
            ))}
          </button>
        }
      />
      <PopoverPopup tooltipStyle side="top" align="end" className="w-max max-w-none px-3 py-2">
        <div className="space-y-1.5 leading-tight">
          <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Usage limits
          </div>
          {windows.map((window) => (
            <div
              key={window.label}
              className="flex items-center justify-between gap-4 whitespace-nowrap text-xs text-foreground"
            >
              <span>{window.label} rolling window</span>
              <span className="font-medium">{formatUsedPercent(window.usedPercent)} used</span>
            </div>
          ))}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
