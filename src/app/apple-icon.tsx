import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// The home-screen icon: the Assay mark from the header (an ink square, a ring and a dot).
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#14201b" }}>
        <svg width="180" height="180" viewBox="0 0 32 32">
          <circle cx="16" cy="16" r="8.6" fill="none" stroke="#f3f5f1" strokeWidth="3" />
          <circle cx="16" cy="16" r="3.2" fill="#f3f5f1" />
        </svg>
      </div>
    ),
    size,
  );
}
