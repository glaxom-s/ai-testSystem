import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "./App.jsx";

describe("App", () => {
  it("renders the studio headline and primary export action", () => {
    render(<App />);
    expect(screen.getByText(/Social-first video studio/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export video/i })).toBeInTheDocument();
  });

  it("lists upload and platform sections", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: /1 · upload/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /2 · platform/i })).toBeInTheDocument();
  });
});
