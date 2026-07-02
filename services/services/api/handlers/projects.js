/** @module services/api/handlers/projects
 *  职责：项目（多文件夹）管理 — 列表 / 创建 / 切换 / 删除 / 重命名 / 更新 / 导出 / 导入
 *  对接 router.js 的 REST 风格路由
 */
import {
  listProjects,
  createProject,
  deleteProject,
  renameProject,
  updateProject,
  switchProject,
  exportProjectData,
  importProjectData
} from '../../storage.js';

/**
 * 校验项目名称
 * @param {string} name - 项目名称
 * @returns {string|null} 错误消息，null 表示校验通过
 */
function validateProjectName(name) {
  if (!name || !name.trim()) return '名称不能为空';
  if (name.length > 50) return '名称不能超过50个字符';
  if (/[<>:"/\\|?*]/.test(name)) return '名称不能包含特殊字符 < > : " / \\ | ? *';
  return null;
}

/**
 * 将磁盘异常转换为友好的错误消息
 * @param {Error} e - 捕获的异常
 * @returns {{error: string}}
 */
function handleDiskError(e) {
  if (e.code === 'ENOSPC') {
    return { success: false, error: '磁盘空间不足，无法完成操作' };
  } else if (e.code === 'EACCES') {
    return { success: false, error: '没有权限访问数据目录' };
  }
  return { success: false, error: '操作失败: ' + e.message };
}

/**
 * GET /projects — 获取项目列表和当前项目 ID
 */
export async function listProjectsHandler() {
  return await listProjects();
}

/**
 * POST /projects — 创建新项目
 * @param {{ name?: string }} params
 */
export async function createProjectHandler({ name } = {}) {
  const validationError = validateProjectName(name);
  if (validationError) {
    return { success: false, error: validationError };
  }
  try {
    const result = await createProject(name);
    if (result.error) {
      return result;
    }
    const data = await listProjects();
    return { project: result, projects: data.projects, currentProjectId: data.currentProjectId };
  } catch (e) {
    return handleDiskError(e);
  }
}

/**
 * POST /projects/switch — 切换当前项目
 * @param {{ projectId?: string }} params
 */
export async function switchProjectHandler({ projectId } = {}) {
  if (!projectId) {
    return { success: false, error: '缺少项目 ID' };
  }
  const result = await switchProject(projectId);
  if (result.error) {
    return result;
  }
  const data = await listProjects();
  return {
    success: true,
    currentProjectId: data.currentProjectId,
    projects: data.projects
  };
}

/**
 * PUT /projects/:id — 更新项目（名称和/或描述）
 * renameProjectHandler 的扩展版本，支持同时更新名称和描述
 * @param {{ id?: string, name?: string, description?: string }} params
 */
export async function updateProjectHandler({ id, name, description } = {}) {
  if (!id) {
    return { success: false, error: '缺少项目 ID' };
  }
  // 如果提供了 name，校验名称
  if (name !== undefined) {
    const validationError = validateProjectName(name);
    if (validationError) {
      return { success: false, error: validationError };
    }
  }
  // 至少要有一个字段需要更新
  if (name === undefined && description === undefined) {
    return { success: false, error: '至少需要提供 name 或 description 字段' };
  }
  try {
    const result = await updateProject(id, { name, description });
    if (result.error) {
      return result;
    }
    const data = await listProjects();
    return { project: result, projects: data.projects };
  } catch (e) {
    return handleDiskError(e);
  }
}

/**
 * PUT /projects/:id — 重命名项目（向后兼容，委托给 updateProjectHandler）
 * @param {{ id?: string, name?: string }} params
 */
export async function renameProjectHandler({ id, name } = {}) {
  if (!id) {
    return { success: false, error: '缺少项目 ID' };
  }
  const validationError = validateProjectName(name);
  if (validationError) {
    return { success: false, error: validationError };
  }
  try {
    const result = await renameProject(id, name);
    if (result.error) {
      return result;
    }
    const data = await listProjects();
    return { project: result, projects: data.projects };
  } catch (e) {
    return handleDiskError(e);
  }
}

/**
 * GET /projects/:id/export — 导出项目数据
 * @param {{ id?: string }} params
 */
export async function exportProjectHandler({ id } = {}) {
  if (!id) {
    return { success: false, error: '缺少项目 ID' };
  }
  try {
    const result = await exportProjectData(id);
    if (result.error) {
      return result;
    }
    return result;
  } catch (e) {
    return handleDiskError(e);
  }
}

/**
 * POST /projects/import — 导入项目数据
 * @param {{ data?: object, name?: string }} params
 */
export async function importProjectHandler({ data, name } = {}) {
  if (!data) {
    return { success: false, error: '缺少项目数据' };
  }
  try {
    const result = await importProjectData(data, name);
    if (result.error) {
      return result;
    }
    const data2 = await listProjects();
    return {
      success: true,
      project: result.project,
      projects: data2.projects,
      currentProjectId: data2.currentProjectId
    };
  } catch (e) {
    return handleDiskError(e);
  }
}

/**
 * DELETE /projects/:id — 删除项目（不能删除最后一个）
 * @param {{ id?: string }} params
 */
export async function deleteProjectHandler({ id } = {}) {
  if (!id) {
    return { success: false, error: '缺少项目 ID' };
  }
  try {
    const result = await deleteProject(id);
    if (result.error) {
      return result;
    }
    const data = await listProjects();
    return {
      success: true,
      projects: data.projects,
      currentProjectId: data.currentProjectId
    };
  } catch (e) {
    return handleDiskError(e);
  }
}
