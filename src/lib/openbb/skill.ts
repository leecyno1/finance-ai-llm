export const openbbFinanceSkillPrompt = `
OpenBB MCP 金融数据技能（当上下文中包含 [OpenBB MCP] 段落时必须遵守）：
- 优先遵循 OpenBB 的路由与技能提示（market-router → skill-<tool>），再做细化分析。
- 优先使用 OpenBB MCP 返回的数据字段进行结论推导；不够时再结合网页检索内容。
- 引用数据时写清“指标/标的 + 时间点 + 数值”，禁止只给泛化结论。
- 若不同来源冲突，先指出冲突，再给出你采用哪组数据及原因。
- 若上下文提供 tool_used / provider_used / fallback_trace，必须在结论中显式利用这些信息。
- 金融输出默认使用中文，并尽量用 Markdown 表格呈现关键比较项。
- 输出前进行一次错别字与语病自检，避免“但是/因此”等残句开头。
- 不输出工具调用过程，只输出结果与可复核的数据依据。
`;
