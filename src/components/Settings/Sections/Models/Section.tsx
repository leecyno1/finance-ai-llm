import React, { useState } from 'react';
import AddProvider from './AddProviderDialog';
import {
  ConfigModelProvider,
  ModelProviderUISection,
  UIConfigField,
} from '@/lib/config/types';
import ModelProvider from './ModelProvider';
import ModelSelect from './ModelSelect';

const Models = ({
  fields,
  values,
}: {
  fields: ModelProviderUISection[];
  values: ConfigModelProvider[];
}) => {
  const [providers, setProviders] = useState<ConfigModelProvider[]>(values);

  return (
    <div className="flex-1 space-y-6 overflow-y-auto py-6">
      <div className="flex flex-col px-6 gap-y-4">
        <h3 className="text-xs lg:text-xs text-black/70 dark:text-white/70">
          模型角色
        </h3>
        <div className="rounded-xl border border-red-500/15 bg-red-500/[0.04] px-4 py-3 text-[11px] leading-5 text-black/60 dark:text-white/60">
          <p><span className="font-semibold text-red-700 dark:text-red-300">日常对话 / 多模态：</span>固定使用 MiniMax-M2.7。</p>
          <p><span className="font-semibold text-blue-700 dark:text-blue-300">高阶深度研究：</span>Academic 或 Deep Research 模式自动使用 Gitee AI DeepSeek-V4-Flash。</p>
          <p><span className="font-semibold text-emerald-700 dark:text-emerald-300">附件与检索向量：</span>优先使用 SiliconFlow BAAI/bge-m3，缺失时回退 MiniMax embedding。</p>
        </div>
        <ModelSelect
          providers={values.filter(
            (p) =>
              p.chatModels.some((m) => m.key != 'error') &&
              !/gitee|deepseek|深度研究|高阶/i.test(p.name),
          )}
          type="chat"
        />
        <ModelSelect
          providers={values.filter((p) =>
            p.embeddingModels.some((m) => m.key != 'error'),
          )}
          type="embedding"
        />
      </div>
      <div className="border-t border-light-200 dark:border-dark-200" />
      <div className="flex flex-row justify-between items-center px-6 ">
        <p className="text-xs lg:text-xs text-black/70 dark:text-white/70">
管理模型连接
        </p>
        <AddProvider modelProviders={fields} setProviders={setProviders} />
      </div>
      <div className="flex flex-col px-6 gap-y-4">
        {providers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 rounded-lg border-2 border-dashed border-light-200 dark:border-dark-200 bg-light-secondary/10 dark:bg-dark-secondary/10">
            <div className="p-3 rounded-full bg-sky-500/10 dark:bg-sky-500/10 mb-3">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-8 h-8 text-sky-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            </div>
            <p className="text-sm font-medium text-black/70 dark:text-white/70 mb-1">
              No connections yet
            </p>
            <p className="text-xs text-black/50 dark:text-white/50 text-center max-w-sm mb-4">
              Add your first connection to start using AI models. Connect to
              OpenAI, Anthropic, Ollama, and more.
            </p>
          </div>
        ) : (
          providers.map((provider) => (
            <ModelProvider
              key={`provider-${provider.id}`}
              fields={
                (fields.find((f) => f.key === provider.type)?.fields ??
                  []) as UIConfigField[]
              }
              modelProvider={provider}
              setProviders={setProviders}
            />
          ))
        )}
      </div>
    </div>
  );
};

export default Models;
