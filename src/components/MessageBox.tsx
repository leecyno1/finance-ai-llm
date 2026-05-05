'use client';

/* eslint-disable @next/next/no-img-element */
import React, { MutableRefObject } from 'react';
import { cn } from '@/lib/utils';
import {
  BookCopy,
  Disc3,
  Volume2,
  StopCircle,
  Layers3,
  Plus,
} from 'lucide-react';
import Markdown, { MarkdownToJSX } from 'markdown-to-jsx';
import Copy from './MessageActions/Copy';
import Rewrite from './MessageActions/Rewrite';
import MessageSources from './MessageSources';
import SearchImages from './SearchImages';
import SearchVideos from './SearchVideos';
import { useSpeech } from 'react-text-to-speech';
import ThinkBox from './ThinkBox';
import { useChat, Section } from '@/lib/hooks/useChat';
import Citation from './Citation';

const ThinkTagProcessor = ({
  children,
  thinkingEnded,
}: {
  children: React.ReactNode;
  thinkingEnded: boolean;
}) => {
  return (
    <ThinkBox content={children as string} thinkingEnded={thinkingEnded} />
  );
};

const formatResearchStatus = (content: string, active: boolean) => {
  if (active) return content;

  return content
    .replace(/^正在检索网页来源/, '已完成网页来源检索')
    .replace(/^已获取来源，正在组织回答/, '已获取来源，已完成回答组织')
    .replace(/^正在整合来源并生成回答/, '已完成来源整合')
    .replace(/^正在生成回答/, '已完成回答生成')
    .replace(/^正在处理中/, '已完成处理')
    .replace(/^正在/, '已完成');
};

const MessageBox = ({
  section,
  sectionIndex,
  dividerRef,
  isLast,
}: {
  section: Section;
  sectionIndex: number;
  dividerRef?: MutableRefObject<HTMLDivElement | null>;
  isLast: boolean;
}) => {
  const { loading, loadingStatus, chatTurns, sendMessage, rewrite } = useChat();

  const parsedMessage = section.parsedAssistantMessage || '';
  const speechMessage = section.speechMessage || '';
  const thinkingEnded = section.thinkingEnded;
  const researchStatusActive = isLast && loading;
  const visibleStatusMessages = section.statusMessages
    .filter((status) => status.content !== '研究过程已完成')
    .map((status) => ({
      ...status,
      content: formatResearchStatus(status.content, researchStatusActive),
    }));

  const { speechStatus, start, stop } = useSpeech({ text: speechMessage });

  const markdownOverrides: MarkdownToJSX.Options = {
    overrides: {
      think: {
        component: ThinkTagProcessor,
        props: {
          thinkingEnded: thinkingEnded,
        },
      },
      citation: {
        component: Citation,
      },
    },
  };

  return (
    <div className="space-y-5">
      <div className={'w-full pt-8 break-words'}>
        <div className="lg:w-9/12 rounded-2xl border border-rose-400/35 dark:border-blue-400/30 bg-gradient-to-r from-rose-500/8 via-rose-500/4 to-blue-500/8 dark:from-rose-500/12 dark:via-rose-500/8 dark:to-blue-500/12 px-4 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]">
          <h2
            className="text-black dark:text-white font-semibold text-sm md:text-base leading-6 overflow-hidden"
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            }}
            title={section.userMessage.content}
          >
            {section.userMessage.content}
          </h2>
        </div>
      </div>

      <div className="flex flex-col space-y-9 lg:space-y-0 lg:flex-row lg:justify-between lg:space-x-9">
        <div
          ref={dividerRef}
          className="flex flex-col space-y-6 w-full lg:w-9/12"
        >
          {section.sourceMessage &&
            section.sourceMessage.sources.length > 0 && (
              <div className="flex flex-col space-y-2">
                <div className="flex flex-row items-center space-x-2">
                  <BookCopy className="text-black dark:text-white" size={20} />
                  <h3 className="text-black dark:text-white font-medium text-lg">
                    Sources
                  </h3>
                </div>
                <MessageSources sources={section.sourceMessage.sources} />
              </div>
            )}

          {section.statusMessages.length > 0 && (
            <div className="rounded-2xl border border-rose-400/20 dark:border-blue-400/20 bg-white/70 dark:bg-white/5 px-4 py-3">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'inline-block h-2 w-2 rounded-full bg-rose-500 dark:bg-blue-400',
                    researchStatusActive ? 'animate-pulse' : 'opacity-60',
                  )}
                />
                <h3 className="text-sm font-semibold text-black dark:text-white">
                  {researchStatusActive ? '研究过程' : '研究过程已完成'}
                </h3>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {visibleStatusMessages.map((status) => (
                  <span
                    key={status.messageId}
                    className="rounded-full border border-rose-400/25 dark:border-blue-400/25 bg-rose-500/8 dark:bg-blue-500/10 px-3 py-1 text-xs leading-5 text-black/75 dark:text-white/75"
                  >
                    {status.content}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col space-y-2">
            {section.sourceMessage && (
              <div className="flex flex-row items-center space-x-2">
                <Disc3
                  className={cn(
                    'text-black dark:text-white',
                    isLast && loading ? 'animate-spin' : 'animate-none',
                  )}
                  size={20}
                />
                <h3 className="text-black dark:text-white font-medium text-lg">
                  Answer
                </h3>
              </div>
            )}

            {isLast && loading && section.sourceMessage && (
              <p className="text-sm text-black/70 dark:text-white/70">
                {loadingStatus || '正在处理中...'}
              </p>
            )}

            {section.assistantMessage && (
              <>
                <Markdown
                  className={cn(
                    'prose prose-sm dark:prose-invert prose-h1:mb-2 prose-h1:text-xl prose-h2:mb-2 prose-h2:mt-5 prose-h2:text-lg prose-h2:font-[750] prose-h3:mt-3 prose-h3:mb-1 prose-h3:text-base prose-h3:font-[650] prose-p:text-[0.95rem] prose-p:leading-7 prose-li:text-[0.95rem] prose-li:leading-7 prose-table:text-sm prose-pre:p-0 font-[400]',
                    'max-w-none break-words text-black dark:text-white',
                  )}
                  options={markdownOverrides}
                >
                  {parsedMessage}
                </Markdown>

                {loading && isLast ? null : (
                  <div className="flex flex-row items-center justify-between w-full text-black dark:text-white py-4 -mx-2">
                    <div className="flex flex-row items-center space-x-1">
                      <Rewrite
                        rewrite={rewrite}
                        messageId={section.assistantMessage.messageId}
                      />
                    </div>
                    <div className="flex flex-row items-center space-x-1">
                      <Copy
                        initialMessage={section.assistantMessage.content}
                        section={section}
                      />
                      <button
                        onClick={() => {
                          if (speechStatus === 'started') {
                            stop();
                          } else {
                            start();
                          }
                        }}
                        className="p-2 text-black/70 dark:text-white/70 rounded-xl hover:bg-light-secondary dark:hover:bg-dark-secondary transition duration-200 hover:text-black dark:hover:text-white"
                      >
                        {speechStatus === 'started' ? (
                          <StopCircle size={18} />
                        ) : (
                          <Volume2 size={18} />
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {isLast &&
                  section.suggestions &&
                  section.suggestions.length > 0 &&
                  section.assistantMessage &&
                  !loading && (
                    <div className="mt-8 pt-6 border-t border-light-200/50 dark:border-dark-200/50">
                      <div className="flex flex-row items-center space-x-2 mb-4">
                        <Layers3
                          className="text-black dark:text-white"
                          size={20}
                        />
                        <h3 className="text-black dark:text-white font-medium text-lg">
                          Related
                        </h3>
                      </div>
                      <div className="space-y-0">
                        {section.suggestions.map(
                          (suggestion: string, i: number) => (
                            <div key={i}>
                              {i > 0 && (
                                <div className="h-px bg-light-200/40 dark:bg-dark-200/40 mx-3" />
                              )}
                              <button
                                onClick={() => sendMessage(suggestion)}
                                className="group w-full px-3 py-4 text-left transition-colors duration-200"
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <p className="text-sm text-black/70 dark:text-white/70 group-hover:text-rose-600 dark:group-hover:text-rose-300 transition-colors duration-200 leading-relaxed line-clamp-2">
                                    {suggestion}
                                  </p>
                                  <Plus
                                    size={16}
                                    className="text-black/40 dark:text-white/40 group-hover:text-blue-600 dark:group-hover:text-blue-300 transition-colors duration-200 flex-shrink-0"
                                  />
                                </div>
                              </button>
                            </div>
                          ),
                        )}
                      </div>
                    </div>
                  )}
              </>
            )}
          </div>
        </div>

        {section.assistantMessage && (
          <div className="lg:sticky lg:top-20 flex flex-col items-center space-y-3 w-full lg:w-3/12 z-30 h-full pb-4">
            <SearchImages
              query={section.userMessage.content}
              chatHistory={chatTurns.slice(0, sectionIndex * 2)}
              messageId={section.assistantMessage.messageId}
            />
            <SearchVideos
              chatHistory={chatTurns.slice(0, sectionIndex * 2)}
              query={section.userMessage.content}
              messageId={section.assistantMessage.messageId}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default MessageBox;
