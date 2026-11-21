<template>
  <k-layout>
    <div class="page">
      <div class="toolbar">
        <div class="title">聊天收藏</div>
        <div class="filters">
          <el-input
            v-model="filters.keyword"
            placeholder="关键词"
            clearable
            style="width: 160px"
            @keyup.enter="reload"
          />
          <el-input
            v-model="filters.from"
            placeholder="发送者"
            clearable
            style="width: 120px"
            @keyup.enter="reload"
          />
          <el-select v-model="filters.visibility" style="width: 120px" @change="reload">
            <el-option label="全部可见性" value="all" />
            <el-option label="仅自己" value="private" />
            <el-option label="本群可见" value="channel" />
            <el-option label="公开" value="public" />
          </el-select>
          <el-select v-model="filters.deleted" style="width: 130px" @change="reload">
            <el-option label="全部状态" value="all" />
            <el-option label="仅正常" value="none" />
            <el-option label="回收站" value="only" />
          </el-select>
          <el-date-picker
            v-model="filters.range"
            type="datetimerange"
            start-placeholder="起始时间"
            end-placeholder="截止时间"
            style="width: 340px"
            @change="reload"
          />
          <el-button type="primary" @click="reload">查询</el-button>
          <el-button @click="reset">重置</el-button>
        </div>
      </div>

      <div class="batchbar">
        <span class="hint">已选 {{ selection.length }} 条</span>
        <el-button size="small" :disabled="!selection.length" @click="removeSelected">批量软删除</el-button>
        <el-button size="small" :disabled="!selection.length" @click="restoreSelected">批量恢复</el-button>
        <el-button size="small" type="danger" :disabled="!selectedDeleted.length" @click="purgeSelected">
          硬删除选中（{{ selectedDeleted.length }}）
        </el-button>
        <span class="spacer" />
        <el-button size="small" type="danger" plain @click="purgeAll">清空回收站</el-button>
      </div>

      <el-table
        ref="tableRef"
        v-loading="loading"
        :data="items"
        row-key="id"
        size="small"
        stripe
        style="width: 100%"
        @row-dblclick="openDetail"
        @selection-change="onSelectionChange"
      >
        <el-table-column type="selection" width="42" />
        <el-table-column prop="key" label="ID" width="92" />
        <el-table-column prop="sender" label="发送者" width="130" show-overflow-tooltip />
        <el-table-column prop="preview" label="内容" min-width="240" show-overflow-tooltip />
        <el-table-column prop="messageCount" label="条数" width="70" align="center" />
        <el-table-column label="可见性" width="120">
          <template #default="{ row }">
            <el-select
              :model-value="row.visibility"
              size="small"
              @change="(value: string) => changeVisibility(row, value)"
            >
              <el-option label="仅自己" value="private" />
              <el-option label="本群可见" value="channel" />
              <el-option label="公开" value="public" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="来源" width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ row.source }}</template>
        </el-table-column>
        <el-table-column label="收藏时间" width="160">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="80" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.deleted" type="info" size="small">已删除</el-tag>
            <el-tag v-else type="success" size="small">正常</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="250" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openDetail(row)">查看</el-button>
            <el-button link type="primary" size="small" @click="exportClip(row, 'json')">JSON</el-button>
            <el-button link type="primary" size="small" @click="exportClip(row, 'html')">HTML</el-button>
            <el-button
              v-if="!row.deleted"
              link
              type="danger"
              size="small"
              @click="removeClip(row)"
            >删除</el-button>
            <template v-else>
              <el-button link type="warning" size="small" @click="restoreClip(row)">恢复</el-button>
              <el-button link type="danger" size="small" @click="purgeClip(row)">硬删除</el-button>
            </template>
          </template>
        </el-table-column>
      </el-table>

      <div class="footer">
        <el-pagination
          v-model:current-page="page"
          :page-size="pageSize"
          :total="total"
          layout="total, prev, pager, next"
          @current-change="load"
        />
      </div>

      <el-drawer v-model="drawer" :title="detail?.clip?.key || '收藏详情'" size="560px">
        <template v-if="detail">
          <div class="meta">
            <div><span>发送者</span>{{ detail.clip.ownerName }}</div>
            <div><span>可见性</span>{{ visibilityLabel(detail.clip.visibility) }}</div>
            <div><span>条数</span>{{ detail.clip.messageCount }}</div>
            <div><span>来源</span>{{ detail.clip.meta?.channelName || detail.clip.meta?.guildName || detail.clip.channelId }}</div>
            <div><span>收藏时间</span>{{ formatTime(detail.clip.createdAt) }}</div>
            <div><span>消息时间</span>{{ formatTime(detail.messages[0]?.timestamp) }}</div>
          </div>

          <div v-if="detail.clip.degraded?.length" class="degraded">
            ⚠️ 降级：{{ detail.clip.degraded.join(', ') }}
          </div>

          <div class="section-title">消息</div>
          <div v-for="(message, index) in detail.messages" :key="message.id" class="message">
            <div class="message-head">
              <span class="ordinal">{{ index + 1 }}</span>
              <span class="role">{{ roleLabel(message.role) }}</span>
              <span class="sender">{{ message.nickname || message.username || message.userId }}</span>
              <span class="time">{{ formatTime(message.timestamp) }}</span>
            </div>
            <div class="message-body">{{ bodyText(message.content) }}</div>
          </div>

          <template v-if="detail.attachments.length">
            <div class="section-title">附件</div>
            <div class="attachments">
              <a
                v-for="item in detail.attachments"
                :key="item.id"
                :href="item.url"
                target="_blank"
                class="attachment"
              >
                <img v-if="isImage(item)" :src="item.url" />
                <span v-else class="file">{{ attachmentLabel(item) }}</span>
              </a>
            </div>
          </template>
        </template>
      </el-drawer>
    </div>
  </k-layout>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { send } from '@koishijs/client'

interface ClipRow {
  id: number
  key: string
  sender: string
  preview: string
  messageCount: number
  visibility: string
  source: string
  channelId: string
  createdAt: number
  deleted: boolean
}

interface Detail {
  clip: any
  messages: any[]
  attachments: { id: number, type: string, url: string, filename?: string }[]
}

const loading = ref(false)
const items = ref<ClipRow[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)

const tableRef = ref<any>(null)
const selection = ref<ClipRow[]>([])
const selectedIds = computed(() => selection.value.map((row) => row.id))
const selectedDeleted = computed(() => selection.value.filter((row) => row.deleted))

const filters = reactive({
  keyword: '',
  from: '',
  visibility: 'all',
  deleted: 'all' as 'all' | 'none' | 'only',
  range: null as null | [Date, Date],
})

const drawer = ref(false)
const detail = ref<Detail | null>(null)

function formatTime(value?: number | string) {
  if (!value) return ''
  const date = new Date(value)
  if (isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function visibilityLabel(value: string) {
  return value === 'public' ? '公开' : value === 'channel' ? '本群可见' : '仅自己'
}

function roleLabel(role: string) {
  return role === 'main' ? '主消息' : role === 'quote' ? '引用' : '转发'
}

function isImage(item: { type: string }) {
  return item.type === 'img' || item.type === 'image'
}

function bodyText(content?: string) {
  const clean = (content ?? '')
    .replace(/\[(图片|视频|语音|文件)\]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim()
  return clean || '[无文字内容]'
}

function attachmentLabel(item: { type: string, filename?: string }) {
  if (item.filename) return item.filename
  return item.type === 'file' ? '[文件]' : item.type === 'video' ? '[视频]' : '[语音]'
}

async function load() {
  loading.value = true
  try {
    const result = await send('chatclip/list', {
      keyword: filters.keyword || undefined,
      from: filters.from || undefined,
      visibility: filters.visibility,
      deleted: filters.deleted,
      start: filters.range?.[0]?.toISOString(),
      end: filters.range?.[1]?.toISOString(),
      page: page.value,
      pageSize: pageSize.value,
    })
    if (!result) return
    items.value = result.items
    total.value = result.total
    selection.value = []
  } finally {
    loading.value = false
  }
}

function onSelectionChange(rows: ClipRow[]) {
  selection.value = rows
}

function reload() {
  page.value = 1
  load()
}

function reset() {
  filters.keyword = ''
  filters.from = ''
  filters.visibility = 'all'
  filters.deleted = 'all'
  filters.range = null
  reload()
}

async function openDetail(row: ClipRow) {
  const result = await send('chatclip/get', row.id)
  if (!result) return
  detail.value = result as Detail
  drawer.value = true
}

async function removeClip(row: ClipRow) {
  await send('chatclip/remove', row.id)
  row.deleted = true
  load()
}

async function restoreClip(row: ClipRow) {
  await send('chatclip/restore', row.id)
  row.deleted = false
  load()
}

async function purgeClip(row: ClipRow) {
  if (!row.deleted) {
    alert('只有已经软删除的收藏才能硬删除。')
    return
  }
  if (!confirm(`硬删除 ${row.key}？消息与附件记录会一并删除，无法恢复。`)) return
  const result = await send('chatclip/purge', { ids: [row.id] })
  if (!result?.ids?.length) alert('硬删除失败：这条收藏还不是软删除状态。')
  load()
}

async function removeSelected() {
  if (!selectedIds.value.length) return
  if (!confirm(`把选中的 ${selectedIds.value.length} 条放进回收站？`)) return
  await send('chatclip/removeMany', selectedIds.value)
  load()
}

async function restoreSelected() {
  if (!selectedIds.value.length) return
  await send('chatclip/restoreMany', selectedIds.value)
  load()
}

async function purgeSelected() {
  const ids = selectedDeleted.value.map((row) => row.id)
  if (!ids.length) {
    alert('选中的行里没有已软删除的收藏。')
    return
  }
  if (!confirm(`硬删除选中的 ${ids.length} 条？无法恢复。`)) return
  await send('chatclip/purge', { ids })
  load()
}

async function purgeAll() {
  if (!confirm('清空回收站：所有已软删除的收藏都会被永久删除，无法恢复。')) return
  const result = await send('chatclip/purge', { all: true })
  const count = result?.ids?.length ?? 0
  alert(count ? `已永久删除 ${count} 条。` : '回收站是空的。')
  load()
}

async function changeVisibility(row: ClipRow, value: string) {
  await send('chatclip/visibility', { id: row.id, visibility: value })
  row.visibility = value
}

async function exportClip(row: ClipRow, format: 'json' | 'html') {
  const content = await send('chatclip/export', { id: row.id, format })
  if (!content) return
  const blob = new Blob([content], {
    type: format === 'json' ? 'application/json' : 'text/html',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${row.key}.${format}`
  anchor.click()
  URL.revokeObjectURL(url)
}

onMounted(load)
</script>

<style scoped>
.page {
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.title {
  font-size: 18px;
  font-weight: 600;
}

.filters {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.footer {
  display: flex;
  justify-content: flex-end;
}

.batchbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--bg2);
  font-size: 13px;
}

.batchbar .hint {
  color: var(--fg3);
  margin-right: 4px;
}

.batchbar .spacer {
  flex: 1;
}

.meta {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 16px;
  margin-bottom: 16px;
  font-size: 13px;
}

.meta span {
  color: var(--fg3);
  margin-right: 8px;
}

.degraded {
  background: var(--bg2);
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 13px;
  color: #c07a00;
  margin-bottom: 16px;
}

.section-title {
  font-weight: 600;
  margin: 16px 0 8px;
}

.message {
  border-left: 3px solid var(--k-color-primary);
  padding: 6px 0 6px 12px;
  margin-bottom: 10px;
}

.message-head {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 13px;
  color: var(--fg3);
}

.ordinal {
  font-weight: 600;
  color: var(--k-color-primary);
}

.role {
  background: var(--bg2);
  border-radius: 4px;
  padding: 0 6px;
}

.sender {
  color: var(--fg2);
}

.message-body {
  margin-top: 4px;
  white-space: pre-wrap;
  word-break: break-word;
}

.attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.attachment img {
  width: 96px;
  height: 96px;
  object-fit: cover;
  border-radius: 6px;
}

.attachment .file {
  display: inline-block;
  padding: 6px 10px;
  background: var(--bg2);
  border-radius: 6px;
  font-size: 13px;
}
</style>
