import { addUser, selectUser } from "@/app/actions";

export default function UserPicker({ users }: { users: string[] }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-6 px-4 pt-24 text-center">
      <div>
        <h1 className="text-lg font-semibold">你是誰？</h1>
        <p className="mt-1 text-sm text-zinc-500">選擇後這台裝置會記住，之後不用再選。</p>
      </div>

      {users.length > 0 && (
        <div className="flex w-full flex-col gap-2">
          {users.map((name) => (
            <form key={name} action={selectUser}>
              <input type="hidden" name="name" value={name} />
              <button
                type="submit"
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 py-3 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-800"
              >
                {name}
              </button>
            </form>
          ))}
        </div>
      )}

      <form action={addUser} className="flex w-full gap-2">
        <input
          type="text"
          name="name"
          required
          maxLength={20}
          placeholder="輸入新名字加入"
          className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
        />
        <button type="submit" className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950">
          加入
        </button>
      </form>
    </div>
  );
}
