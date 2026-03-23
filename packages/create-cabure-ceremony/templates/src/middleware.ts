export { default } from "next-auth/middleware";

export const config = {
  matcher: [
    "/api/ceremony/queue",
    "/api/ceremony/circuits/:path*/contribute",
    "/api/ceremony/circuits/:path*/upload",
  ],
};
