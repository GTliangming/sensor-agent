// Package knowledge 是“知识库”业务线的特性包。当前为骨架：返回空结果与说明文案，
// 后续接入文档索引与向量检索时，在本包内补充 repository 与真实检索逻辑。
package knowledge

// Service 暂无外部依赖；后续接入向量库/文档索引时在此注入。
type Service struct{}

// NewService 构造知识库服务。
func NewService() *Service { return &Service{} }

// List 是知识库列表的返回结构（骨架）。
type List struct {
	Items   []any  `json:"items"`
	Total   int    `json:"total"`
	Message string `json:"message"`
}

// SearchResult 是知识库检索的返回结构（骨架）。
type SearchResult struct {
	Query   string `json:"query"`
	Items   []any  `json:"items"`
	Message string `json:"message"`
}

// List 返回知识库列表占位结果。
func (s *Service) List() List {
	return List{Items: []any{}, Total: 0, Message: "知识库接口骨架已就绪，下一阶段接入文档索引与向量检索。"}
}

// Search 返回知识库检索占位结果。query 的必填校验由 controller 完成。
func (s *Service) Search(query string) SearchResult {
	return SearchResult{Query: query, Items: []any{}, Message: "当前为接口骨架，尚未接入向量数据库。"}
}
