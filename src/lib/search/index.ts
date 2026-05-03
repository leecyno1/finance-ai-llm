import MetaSearchAgent, { MetaSearchAgentType } from '@/lib/search/metaSearchAgent';
import prompts from '../prompts';
import EventImpactSearchHandler from './handlers/eventImpactSearch';
import PortfolioCheckSearchHandler from './handlers/portfolioCheckSearch';

export type SearchHandlerCapabilities = {
  requiresModels: boolean;
  supportsResearchTimeline: boolean;
  deterministic: boolean;
};

export const searchHandlers: Record<string, MetaSearchAgentType> = {
  webSearch: new MetaSearchAgent({
    activeEngines: [],
    queryGeneratorPrompt: prompts.webSearchRetrieverPrompt,
    responsePrompt: prompts.webSearchResponsePrompt,
    queryGeneratorFewShots: prompts.webSearchRetrieverFewShots,
    rerank: true,
    rerankThreshold: 0.3,
    searchWeb: true,
  }),
  academicSearch: new MetaSearchAgent({
    activeEngines: ['arxiv', 'google scholar', 'pubmed'],
    queryGeneratorPrompt: prompts.webSearchRetrieverPrompt,
    responsePrompt: prompts.webSearchResponsePrompt,
    queryGeneratorFewShots: prompts.webSearchRetrieverFewShots,
    rerank: true,
    rerankThreshold: 0,
    searchWeb: true,
  }),
  writingAssistant: new MetaSearchAgent({
    activeEngines: [],
    queryGeneratorPrompt: '',
    queryGeneratorFewShots: [],
    responsePrompt: prompts.writingAssistantPrompt,
    rerank: true,
    rerankThreshold: 0,
    searchWeb: false,
  }),
  wolframAlphaSearch: new MetaSearchAgent({
    activeEngines: ['wolframalpha'],
    queryGeneratorPrompt: prompts.webSearchRetrieverPrompt,
    responsePrompt: prompts.webSearchResponsePrompt,
    queryGeneratorFewShots: prompts.webSearchRetrieverFewShots,
    rerank: false,
    rerankThreshold: 0,
    searchWeb: true,
  }),
  youtubeSearch: new MetaSearchAgent({
    activeEngines: ['youtube'],
    queryGeneratorPrompt: prompts.webSearchRetrieverPrompt,
    responsePrompt: prompts.webSearchResponsePrompt,
    queryGeneratorFewShots: prompts.webSearchRetrieverFewShots,
    rerank: true,
    rerankThreshold: 0.3,
    searchWeb: true,
  }),
  redditSearch: new MetaSearchAgent({
    activeEngines: ['reddit'],
    queryGeneratorPrompt: prompts.webSearchRetrieverPrompt,
    responsePrompt: prompts.webSearchResponsePrompt,
    queryGeneratorFewShots: prompts.webSearchRetrieverFewShots,
    rerank: true,
    rerankThreshold: 0.3,
    searchWeb: true,
  }),
  eventImpactMatrix: new EventImpactSearchHandler(),
  portfolioCheck: new PortfolioCheckSearchHandler(),
};

const DEFAULT_HANDLER_CAPABILITIES: SearchHandlerCapabilities = {
  requiresModels: true,
  supportsResearchTimeline: true,
  deterministic: false,
};

export const searchHandlerCapabilities: Record<
  string,
  SearchHandlerCapabilities
> = {
  webSearch: DEFAULT_HANDLER_CAPABILITIES,
  academicSearch: DEFAULT_HANDLER_CAPABILITIES,
  writingAssistant: {
    requiresModels: true,
    supportsResearchTimeline: false,
    deterministic: false,
  },
  wolframAlphaSearch: DEFAULT_HANDLER_CAPABILITIES,
  youtubeSearch: DEFAULT_HANDLER_CAPABILITIES,
  redditSearch: DEFAULT_HANDLER_CAPABILITIES,
  eventImpactMatrix: {
    requiresModels: false,
    supportsResearchTimeline: true,
    deterministic: true,
  },
  portfolioCheck: {
    requiresModels: false,
    supportsResearchTimeline: false,
    deterministic: true,
  },
};

export const getSearchHandlerCapabilities = (
  focusMode: string,
): SearchHandlerCapabilities =>
  searchHandlerCapabilities[focusMode] ?? DEFAULT_HANDLER_CAPABILITIES;
