import { AskDock } from './components/AskDock';
import { LoginGate } from './components/LoginGate';
import { Toast } from './components/Toast';
import { SheetHost } from './sheets/SheetHost';
import { useUIStore } from './store/ui';
import { ControlDeck } from './views/ControlDeck';

/**
 * 사이드패널 셸 — macOS 제어 센터 구조.
 *
 * 헤더는 두지 않는다. 새로고침·설정은 격자 안의 아이콘 위젯이라
 * 사용자가 다른 위젯과 똑같이 옮기거나 숨길 수 있다.
 */
export default function App() {
  // 시트가 덱을 가릴 뿐 언마운트하지는 않으므로, 가려진 덱으로 탭 이동이 새는 것을 막는다.
  const sheetOpen = useUIStore((s) => s.sheets.length > 0);

  return (
    <LoginGate>
      <div className="flex h-full w-full flex-col overflow-hidden bg-orbit-bg text-orbit-text">
        <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          <div className="h-full" inert={sheetOpen}>
            <ControlDeck />
          </div>
          <SheetHost />
        </main>
        <AskDock />
        <Toast />
      </div>
    </LoginGate>
  );
}
