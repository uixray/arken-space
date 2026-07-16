import { lazy } from "react";

export const FoundationPreviewRoute = lazy(() =>
  import("./GravityFoundationPreview").then((module) => ({
    default: module.GravityFoundationPreview,
  })),
);
