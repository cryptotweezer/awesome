import { ImageResponse } from "next/og";
import { join } from "node:path";
import { readFile } from "node:fs/promises";

/**
 * The card every messaging app draws when somebody pastes the link.
 *
 * It renders at build time from the same words as the landing hero, so the
 * two cannot say different things. Nothing here is theme aware on purpose: a
 * preview card is drawn once and shown to everybody, so it commits to the
 * light side and uses the black logo, which is the one that survives on it.
 *
 * The bundled font is Geist Regular and only that weight, so hierarchy comes
 * from size and colour rather than from bold. Asking for 700 here would
 * silently render at 400 and look like a mistake instead of a decision.
 */

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "AI Billing Service. Invoicing an AI can actually run.";

// Read once when the module loads, not per request: it never changes.
const logo = await readFile(
  join(process.cwd(), "public", "logo_ah_black.png"),
  "base64",
);
const logoSrc = `data:image/png;base64,${logo}`;

const INK = "#0f172a";
const MUTED = "#475569";
const FAINT = "#94a3b8";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "68px 76px",
          background: "#ffffff",
          backgroundImage:
            "radial-gradient(circle at 88% 8%, rgba(16,185,129,0.10) 0%, transparent 42%), radial-gradient(circle at 4% 96%, rgba(15,23,42,0.05) 0%, transparent 38%)",
          fontFamily: "sans-serif",
          color: INK,
        }}
      >
        {/* Wordmark */}
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {/* Plain img on purpose: this tree is rendered by Satori, which
              knows nothing about next/image. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoSrc} width={76} height={76} alt="" />
          <div style={{ display: "flex", fontSize: 34, letterSpacing: -0.6 }}>
            AI Billing Service
          </div>
        </div>

        {/* The pitch, in the landing's own words */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              alignSelf: "flex-start",
              padding: "11px 22px",
              borderRadius: 999,
              background: "#f1f5f9",
              fontSize: 22,
              color: MUTED,
            }}
          >
            <div
              style={{
                width: 11,
                height: 11,
                borderRadius: 999,
                background: "#10b981",
              }}
            />
            Works with the AI you already use
          </div>

          <div
            style={{
              display: "flex",
              marginTop: 26,
              maxWidth: 940,
              fontSize: 80,
              lineHeight: 1.04,
              letterSpacing: -2.6,
            }}
          >
            Invoicing an AI can actually run.
          </div>

          <div
            style={{
              display: "flex",
              marginTop: 24,
              maxWidth: 900,
              fontSize: 27,
              lineHeight: 1.45,
              color: MUTED,
            }}
          >
            Tell an AI to bill the job and it is billed. Bring the AI you
            already use, or use the one built in.
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: 26,
            borderTop: "1px solid #e2e8f0",
            fontSize: 22,
            color: FAINT,
          }}
        >
          <div style={{ display: "flex" }}>billing.andreshenao.com.au</div>
          <div style={{ display: "flex" }}>
            Invoices · Reminders · Tax statements
          </div>
        </div>
      </div>
    ),
    size,
  );
}
