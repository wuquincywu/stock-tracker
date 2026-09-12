import { switchUser } from "@/app/actions";

export default function UserSwitcher({ name }: { name: string }) {
  return (
    <form action={switchUser} className="flex items-center gap-1.5 text-sm text-zinc-400">
      <span>{name}</span>
      <button type="submit" className="text-zinc-500 underline-offset-2 hover:text-zinc-100 hover:underline">
        切換
      </button>
    </form>
  );
}
