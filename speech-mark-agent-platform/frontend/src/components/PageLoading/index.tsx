import { Spin } from 'antd';

export default function PageLoading() {
    return (
        <div className="page-loading">
            <Spin tip="加载中…" />
        </div>
    );
}
