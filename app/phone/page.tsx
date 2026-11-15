import type { Metadata } from "next";
import WebPhone from "./web-phone";

export const metadata: Metadata = { title: "Parallel Dialer · Phone" };

export default function PhonePage() {
  return <WebPhone />;
}
