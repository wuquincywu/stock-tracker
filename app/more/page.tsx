import Link from "next/link";
import BackButton from "@/components/ui/BackButton";

const LINKS = [
  { href: "/faq", label: "常見問題" },
  { href: "/api-status", label: "API 存取狀況" },
];

export default function MorePage() {
  return (
    <div className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <BackButton />
      <h1 className="mb-4 text-xl font-semibold">其他</h1>
      <ul className="flex flex-col gap-2">
        {LINKS.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="block rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-sm font-medium transition-colors hover:border-zinc-700"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
