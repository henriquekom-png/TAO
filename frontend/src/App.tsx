import { useState, useCallback } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { Sidebar } from './components/layout/Sidebar';
import { DocumentViewer } from './components/document/DocumentViewer';
import { AnnotationPanel } from './components/document/AnnotationPanel';
import { GlobalSearch } from './components/layout/GlobalSearch';
import { LoginGate } from './components/layout/LoginGate';

import { QuizSessionModal } from './components/quiz/QuizSessionModal';
import { QuestoesHub } from './components/quiz/QuestoesHub';
import { PanelLeft, ClipboardList } from 'lucide-react';
import { PortalNavigationTarget } from './hooks/usePortals';
import { cn } from './lib/utils';
import type { Questao } from './types';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => sessionStorage.getItem('tao_auth') === 'true');
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [selectedBlocoId, setSelectedBlocoId] = useState<string | null>(null);

  const [isQuizSessionOpen, setIsQuizSessionOpen] = useState(false);
  const [isHubActive, setIsHubActive] = useState(false);
  const [expandPastaIds, setExpandPastaIds] = useState<string[]>([]);
  const [scrollToBlocoId, setScrollToBlocoId] = useState<string | null>(null);
  const [preloadedQuestions, setPreloadedQuestions] = useState<Questao[] | undefined>(undefined);
  const [hubEditingQuestao, setHubEditingQuestao] = useState<Questao | null>(null);

  const handleGenerateSimulado = useCallback((questions: Questao[]) => {
    setPreloadedQuestions(questions);
    setIsQuizSessionOpen(true);
  }, []);

  // Selecting a document exits hub mode
  const handleSelectDoc = useCallback((id: string) => {
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
    <div className="h-full overflow-y-auto bg-zinc-50/50">
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
    <div className="h-screen w-screen bg-zinc-50 overflow-hidden font-sans text-zinc-900 flex flex-col">
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
        <Panel id="workspace-panel" className="h-full min-w-0 bg-white flex flex-col">
          <header className="h-14 bg-background border-b border-border flex items-center justify-between px-6 shrink-0 shadow-soft-sm z-10 relative select-none">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="p-1.5 hover:bg-slate-100 rounded-md text-slate-500 hover:text-slate-800 transition-colors"
                title={isSidebarOpen ? "Recolher barra lateral" : "Expandir barra lateral"}
              >
                <PanelLeft size={18} className={isSidebarOpen ? "" : "rotate-180"} />
              </button>
              <h1 className="font-semibold text-foreground text-lg tracking-tight">Ambiente de Estudos</h1>
            </div>

            <GlobalSearch onSelectResult={handleGoToSource} />

            <div className="flex items-center gap-3">
              <button
                id="quiz-session-open-btn"
                onClick={() => setIsQuizSessionOpen(true)}
                className="flex items-center gap-2 bg-slate-100 text-slate-700 px-3 py-1.5 rounded-full text-sm font-semibold hover:bg-slate-200 transition-colors border border-slate-200"
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
    </div