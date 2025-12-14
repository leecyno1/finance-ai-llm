'use client';

import { Document } from '@langchain/core/documents';
import Navbar from './Navbar';
import Chat from './Chat';
import EmptyChat from './EmptyChat';
import NextError from 'next/error';
import { useChat } from '@/lib/hooks/useChat';
import Loader from './ui/Loader';

export interface BaseMessage {
  chatId: string;
  messageId: string;
  createdAt: Date;
}

export interface AssistantMessage extends BaseMessage {
  role: 'assistant';
  content: string;
  suggestions?: string[];
}

export interface UserMessage extends BaseMessage {
  role: 'user';
  content: string;
}

export interface SourceMessage extends BaseMessage {
  role: 'source';
  sources: Document[];
}

export interface SuggestionMessage extends BaseMessage {
  role: 'suggestion';
  suggestions: string[];
}

export type Message =
  | AssistantMessage
  | UserMessage
  | SourceMessage
  | SuggestionMessage;
export type ChatTurn = UserMessage | AssistantMessage;

export interface File {
  fileName: string;
  fileExtension: string;
  fileId: string;
}

const ChatWindow = () => {
  const { hasError, isReady, notFound, messages } = useChat();
  if (hasError) {
    return (
      <div className="relative">
        <div className="flex flex-col items-center justify-center min-h-screen">
          <p className="dark:text-white/70 text-black/70 text-sm">
            Failed to connect to the server. Please try again later.
          </p>
        </div>
      </div>
    );
  }

  if (notFound) {
    return <NextError statusCode={404} />;
  }

  // 即使还在初始化（isReady 为 false），也直接展示主界面，
  // 避免全屏大圆圈加载动画挡住内容。
  return (
    <div>
      {messages.length > 0 ? (
        <>
          <Navbar />
          <Chat />
        </>
      ) : (
        <EmptyChat />
      )}
    </div>
  );
};

export default ChatWindow;
