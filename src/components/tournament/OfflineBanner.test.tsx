import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OfflineBanner } from "./OfflineBanner";

describe("OfflineBanner", () => {
  it("renders nothing when online and no pending writes", () => {
    const { container } = render(
      <OfflineBanner fromCache={false} hasPendingWrites={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the syncing banner when online but has pending writes", () => {
    render(<OfflineBanner fromCache={false} hasPendingWrites={true} />);
    expect(screen.getByTestId("offline-banner-syncing")).toBeInTheDocument();
    expect(screen.getByText(/同期中/)).toBeInTheDocument();
    expect(screen.queryByTestId("offline-banner-disconnected")).toBeNull();
  });

  it("renders the disconnected banner when fromCache is true (regardless of pending writes)", () => {
    render(<OfflineBanner fromCache={true} hasPendingWrites={false} />);
    expect(screen.getByTestId("offline-banner-disconnected")).toBeInTheDocument();
    expect(screen.getByText(/通信が一時切れています/)).toBeInTheDocument();
  });

  it("prioritizes the disconnected banner when both fromCache and hasPendingWrites are true", () => {
    render(<OfflineBanner fromCache={true} hasPendingWrites={true} />);
    expect(screen.getByTestId("offline-banner-disconnected")).toBeInTheDocument();
    expect(screen.queryByTestId("offline-banner-syncing")).toBeNull();
  });
});
