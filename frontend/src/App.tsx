import { useState, useCallback, useEffect } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { Sidebar } from './components/layout/Sidebar';
import { DocumentViewer } from './components/document/DocumentViewer';
import { AnnotationPanel } from './components/document/AnnotationPanel';
import { GlobalSearch } from './components/layout/GlobalSearch';
import { LoginGate } from './components/layout/LoginGate';

import { QuizSessionModal } from './components/quiz/QuizSessionModal';
import { QuestoesHub } from './components/quiz/QuestoesHub';
import { PanelLeft, ClipboardList, Sun, Moon } from 'lucide-react';
import { PortalNavigationTarget } from './hooks/usePortals';
import { cn } from './lib/utils';
import type { Questao } from './types';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => sessionStorage.getItem('tao_auth') === 'true');
  const [isDarkMode, setIsDarkMode] = useState(() => sessionStorage.getItem('theme') === 'dark');

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      sessionStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      sessionStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  const [selectedDocId, setSelectedDocId] = useState<number | null>(null);
  const [selectedBlocoId, setSelectedBlocoId] = useState<number | null>(null);

  const [isQuizSessionOpen, setIsQuizSessionOpen] = useState(false);
  const [isHubActive, setIsHubActive] = useState(false);
  const [expandPastaIds, setExpandPastaIds] = useState<number[]>([]);
  const [scrollToBlocoId, setScrollToBlocoId] = useState<number | null>(null);
  const [preloadedQuestions, setPreloadedQuestions] = useState<Questao[] | undefined>(undefined);
  const [hubEditingQuestao, setHubEditingQuestao] = useState<Questao | null>(null);

  const handleGenerateSimulado = useCallback((questions: Questao[]) => {
    setPreloadedQuestions(questions);
    setIsQuizSessionOpen(true);
  }, []);

  // Selecting a document exits hub mode
  const handleSelectDoc = useCallback((id: number) => {
    setSelectedDocId(id);
    setIsHubActive(false);
  }, []);

  // Toggle states for Sidebar
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const handleGoToSource = useCallback((target: PortalNavigationTarget) => {
    setExpandPastaIds(target.pastaPath);
    setSelectedDocId(target.docId);
    setSelectedBlocoId(target.blocoId);
    setScrollToBlocoId(target.blocoId);
    setIsHubActive(false);
  }, []);

  const documentContent = isHubActive ? (
    <QuestoesHub 
      initialEditQuestao={hubEditingQuestao}
      onClearInitialEditQuestao={() => setHubEditingQuestao(null)}
    />
  ) : (
    <div className="h-full overflow-y-auto bg-zinc-50/50 dark:bg-zinc-950 transition-colors">
      <DocumentViewer
        documentId={selectedDocId}
        selectedBlocoId={selectedBlocoId}
        scrollToBlocoId={scrollToBlocoId}
        onScrollComplete={() => setScrollToBlocoId(null)}
        onSelectBloco={setSelectedBlocoId}
        onGenerateSimulado={handleGenerateSimulado}
      />
    </div>
  );

  if (!isAuthenticated) {
    return (
      <LoginGate
        onSuccess={() => {
          sessionStorage.setItem('tao_auth', 'true');
          setIsAuthenticated(true);
        }}
      />
    );
  }

  return (
    <div className="h-screen w-screen bg-zinc-50 dark:bg-background overflow-hidden font-sans text-zinc-900 dark:text-foreground flex flex-col transition-colors">
      <Group orientation="horizontal" id="main-layout" key={`main-layout-${isSidebarOpen}`}>
        {/* Sidebar Panel */}
        {isSidebarOpen && (
          <>
            <Panel
              id="sidebar-panel"
              defaultSize="18%"
              minSize="12%"
              maxSize="25%"
              className="h-full"
            >
              <Sidebar
                onSelectDoc={handleSelectDoc}
                selectedDocId={selectedDocId}
                expandPastaIds={expandPastaIds}
                onSelectHub={() => setIsHubActive(true)}
                isHubActive={isHubActive}
              />
            </Panel>
            <Separator className="w-2.5 flex items-center justify-center group cursor-col-resize select-none h-full z-20 bg-transparent relative">
              <div className="absolute inset-y-0 w-px bg-border group-hover:bg-primary group-active:bg-primary transition-colors duration-200" />
            </Separator>
          </>
        )}

        {/* Central Workspace Panel */}
        <Panel id="workspace-panel" className="h-full min-w-0 bg-white dark:bg-card flex flex-col transition-colors">
          <header className="h-14 bg-background border-b border-border flex items-center justify-between px-6 shrink-0 shadow-soft-sm z-10 relative select-none transition-colors">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="p-1.5 hover:bg-slate-100 rounded-md text-slate-500 hover:text-slate-800 transition-colors"
                title={isSidebarOpen ? "Recolher barra lateral" : "Expandir barra lateral"}
              >
                <PanelLeft size={18} className={isSidebarOpen ? "" : "rotate-180"} />
              </button>
            </div>

            <GlobalSearch onSelectResult={handleGoToSource} />

            <div className="flex items-center gap-3">
              <button
                onClick={() => setIsDarkMode(!isDarkMode)}
                className="relative inline-flex items-center h-[26px] w-[46px] shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-opacity-75 bg-slate-300 dark:bg-zinc-700 shadow-inner"
                title={isDarkMode ? "Mudar para Modo Claro" : "Mudar para Modo Escuro"}
              >
                <span className="sr-only">Toggle Theme</span>
                <span
                  className={cn(
                    "pointer-events-none flex h-5 w-5 transform items-center justify-center rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                    isDarkMode ? "translate-x-5" : "translate-x-0"
                  )}
                >
                  {isDarkMode ? (
                    <Moon size={12} className="text-zinc-700" />
                  ) : (
                    <Sun size={12} className="text-amber-500" />
                  )}
                </span>
              </button>
              <button
                id="quiz-session-open-btn"
                onClick={() => setIsQuizSessionOpen(true)}
                className="flex items-center gap-2 bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-slate-200 px-3 py-1.5 rounded-full text-sm font-semibold hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors border border-slate-200 dark:border-zinc-700"
              >
                <ClipboardList size={16} />
                Simulado
              </button>
            </div>
          </header>

          <div className="flex-1 overflow-hidden min-h-0 relative">
            <Group 
              orientation="horizontal" 
              id="content-split"
              key={`content-split-${selectedBlocoId ? 'with-annotations' : 'no-annotations'}`}
            >
              {/* Document/Blocks Column */}
              <Panel
                id="blocks-panel"
                minSize="30%"
                maxSize="70%"
                defaultSize={selectedBlocoId ? "58%" : "100%"}
                className="h-full"
              >
                {documentContent}
              </Panel>

              {selectedBlocoId && (
                <>
                  <Separator className="w-2.5 flex items-center justify-center group cursor-col-resize select-none h-full z-20 bg-transparent relative">
                    <div className="absolute inset-y-0 w-px bg-border group-hover:bg-primary group-active:bg-primary transition-colors duration-200" />
                  </Separator>

                  {/* Annotation Panel */}
                  <Panel
                    id="annotation-panel"
                    minSize="25%"
                    maxSize="60%"
                    defaultSize="42%"
                    className="h-full"
                  >
                    <AnnotationPanel
                      blocoId={selectedBlocoId}
                      onClose={() => setSelectedBlocoId(null)}
                      onGoToSource={handleGoToSource}
                    />
                  </Panel>
                </>
              )}
            </Group>
          </div>
        </Panel>
      </Group>



      {isQuizSessionOpen && (
        <QuizSessionModal
          preloadedQuestions={preloadedQuestions}
          onClose={() => {
            setIsQuizSessionOpen(false);
            setPreloadedQuestions(undefined);
          }}
          onEditQuestion={(q) => {
            setIsQuizSessionOpen(false);
            setPreloadedQuestions(undefined);
            setHubEditingQuestao(q);
            setIsHubActive(true);
          }}
          onGoToSource={(blocoId) => {
            setIsQuizSessionOpen(false);
            setPreloadedQuestions(undefined);
            setSelectedBlocoId(blocoId);
            setScrollToBlocoId(blocoId);
          }}
        />
      )}
    </div>
  );
}

export default App;
