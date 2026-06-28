/**
 * 可变的 API client mock，测试用例可覆盖具体方法。
 */
export const client = {
  listDocuments: async () => [],
  getGraphStats: async () => ({ nodes: [], edges: [] }),
  listIdeas: async () => [],
  listProjects: async () => ({ projects: [], currentProjectId: null }),
  switchProject: async () => ({ success: true }),
  deleteProject: async () => ({ success: true })
};
