import { createContext } from "preact";
import { useContext, useState } from "preact/hooks";
import { Toast } from "../ui/components";
import { useAppState, useHash } from "../ui/hooks";
import { DetailScreen } from "./DetailScreen";
import { EditorScreen } from "./EditorScreen";
import { ListScreen } from "./ListScreen";

const NotifyContext = createContext<(text: string) => void>(() => undefined);

/** Shows a short message at the bottom ("Saved — in effect now"). */
export const useNotify = () => useContext(NotifyContext);

/** Routes: #/ list · #/set/<id> detail · #/edit/<id> editor · #/new */
export function App() {
  const state = useAppState();
  const hash = useHash();
  const [toast, setToast] = useState<string | null>(null);
  if (!state) return null;

  const [, screen, id] = hash.split("/");
  let content;
  if (screen === "new") content = <EditorScreen state={state} setId={null} />;
  else if (screen === "edit" && id) content = <EditorScreen state={state} setId={decodeURIComponent(id)} />;
  else if (screen === "set" && id) content = <DetailScreen state={state} setId={decodeURIComponent(id)} />;
  else content = <ListScreen state={state} />;

  return (
    <NotifyContext.Provider value={setToast}>
      <main class="app">{content}</main>
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </NotifyContext.Provider>
  );
}
