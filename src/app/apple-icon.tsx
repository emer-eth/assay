import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// The home-screen icon: the hex mark on the app's dark ground.
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#0b0b0e" }}>
        <svg width="130" height="130" viewBox="0 0 32 32">
          <polygon points="16,3.6 26.8,9.8 26.8,22.2 16,28.4 5.2,22.2 5.2,9.8" fill="#17171c" stroke="#ededf0" strokeOpacity="0.85" strokeWidth="1.4" />
          <polygon points="16,10.2 20.3,12.7 20.3,17.7 16,20.2 11.7,17.7 11.7,12.7" fill="#f5a524" />
        </svg>
      </div>
    ),
    size,
  );
}
