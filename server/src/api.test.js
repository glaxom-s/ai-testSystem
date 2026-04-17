import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./index.js";

describe("HTTP API", () => {
  it("GET /api/health returns ok", async () => {
    const res = await request(app).get("/api/health").expect(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("GET /api/presets returns presets and export", async () => {
    const res = await request(app).get("/api/presets").expect(200);
    expect(res.body.presets).toBeDefined();
    expect(res.body.export?.formats?.length).toBeGreaterThan(0);
    expect(res.body.export?.resolutionTiers?.length).toBe(4);
  });

  it("POST /api/render requires uploadId", async () => {
    const res = await request(app).post("/api/render").send({ platform: "instagram-reels" }).expect(400);
    expect(res.body.error).toMatch(/uploadId/i);
  });

  it("POST /api/render returns 404 for missing upload", async () => {
    const res = await request(app)
      .post("/api/render")
      .send({ uploadId: "00000000-0000-0000-0000-000000000000.mp4" })
      .expect(404);
    expect(res.body.error).toMatch(/not found|expired/i);
  });

  it("GET /api/jobs/:id returns 404 for unknown job", async () => {
    const res = await request(app).get("/api/jobs/nonexistent-job-id").expect(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("GET /api/download/:file returns 404 when file missing", async () => {
    const res = await request(app).get("/api/download/missing-file.mp4").expect(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});
