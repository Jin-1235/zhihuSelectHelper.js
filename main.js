// ==UserScript==
// @name         知乎推荐页全选助手v4.4
// @namespace    http://tampermonkey.net/
// @version      4.4
// @description  简化版：专注于回答展开后的内容选择
// @author       YourName
// @match        https://www.zhihu.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

;(function () {
    'use strict'

    const config = {
        buttonStyle: `
            position: absolute;
            right: 20px;
            top: 50%;
            transform: translateY(-50%);
            z-index: 1000;
            padding: 4px 12px;
            font-size: 13px;
            color: #0084ff;
            border: 1px solid #0084ff;
            border-radius: 15px;
            background: rgba(255, 255, 255, 0.9);
            cursor: pointer;
            transition: all 0.2s ease;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            user-select: none;
            &:hover {
                background: rgba(0,132,255,0.1);
                transform: translateY(-50%) scale(1.02);
            }
            &:active {
                transform: translateY(-50%) scale(0.98);
            }
        `,
        retryAttempts: 3,
        retryDelay: 500,
        selectors: {
            answer: '.AnswerItem',
            content: '.RichContent-inner .RichText', // 更新选择器
            header: '.ContentItem-meta',
            expandButton: '.ContentItem-expandButton, .ContentItem-more',
            collapseButton: '[data-zop-retract-question="true"]',
        },
    }

    // 添加防抖函数
    function debounce(func, wait) {
        let timeout
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout)
                func(...args)
            }
            clearTimeout(timeout)
            timeout = setTimeout(later, wait)
        }
    }

    // 带重试机制的函数包装器
    async function withRetry(fn, maxAttempts = config.retryAttempts) {
        let attempts = 0
        while (attempts < maxAttempts) {
            try {
                return await fn()
            } catch (err) {
                attempts++
                if (attempts === maxAttempts) throw err
                await new Promise((resolve) => setTimeout(resolve, config.retryDelay))
            }
        }
    }

    // 优化的按钮创建函数
    function createSelectButton() {
        const btn = document.createElement('button')
        btn.className = 'zh-select-btn'
        btn.textContent = '全选内容'
        btn.style.cssText = config.buttonStyle

        // 添加快捷键提示
        btn.title = '快捷键: Alt + S'

        // 添加点击反馈
        btn.addEventListener('click', function (e) {
            this.style.transform = 'translateY(-50%) scale(0.95)'
            setTimeout(() => {
                this.style.transform = 'translateY(-50%)'
            }, 100)
        })

        return btn
    }

    // 添加键盘快捷键支持
    function setupKeyboardShortcuts(answerEl, btn) {
        const handler = (e) => {
            if (e.altKey && e.key.toLowerCase() === 's') {
                e.preventDefault()
                btn.click()
            }
        }
        document.addEventListener('keydown', handler)

        // 清理函数
        return () => document.removeEventListener('keydown', handler)
    }

    // 选择内容
    function selectContent(answerEl) {
        try {
            const contentEl = answerEl.querySelector(config.selectors.content)
            if (!contentEl || !contentEl.isConnected) {
                console.warn('内容元素不存在或未连接到文档')
                return
            }

            // 计算滚动位置：内容底部减去视口高度的2/3
            const contentRect = contentEl.getBoundingClientRect()
            const scrollTarget = window.pageYOffset + contentRect.bottom - window.innerHeight * 0.66

            // 先滚动到目标位置
            window.scrollTo({
                top: scrollTarget,
                behavior: 'smooth',
            })

            // 等待滚动完成后再选择内容并触发事件
            setTimeout(() => {
                try {
                    const selection = window.getSelection()
                    const range = document.createRange()

                    // 确保range是有效的
                    if (contentEl.firstChild) {
                        range.setStart(contentEl.firstChild, 0)
                        range.setEndAfter(contentEl.lastChild)
                        selection.removeAllRanges()
                        selection.addRange(range)

                        // 触发选择事件序列
                        const mouseupEvent = new MouseEvent('mouseup', {
                            bubbles: true,
                            cancelable: true,
                            view: window,
                            clientX: contentRect.right,
                            clientY: contentRect.bottom,
                        })

                        // 触发 selectionchange 事件
                        const selectionChangeEvent = new Event('selectionchange', {
                            bubbles: true,
                            cancelable: true,
                        })

                        // 按顺序触发事件
                        document.dispatchEvent(selectionChangeEvent)
                        contentEl.dispatchEvent(mouseupEvent)

                        // 如果上面的事件不起作用，可以尝试创建一个自定义事件
                        const customSelectEvent = new CustomEvent('textSelect', {
                            bubbles: true,
                            cancelable: true,
                            detail: {
                                selectedText: selection.toString(),
                                target: contentEl,
                            },
                        })
                        contentEl.dispatchEvent(customSelectEvent)

                        console.log('内容已选择并触发事件')
                    }
                } catch (err) {
                    console.warn('选择内容时出错:', err)
                }
            }, 300) // 增加延时确保滚动完成
        } catch (err) {
            console.warn('处理选择时出错:', err)
        }
    }

    // 优化的处理回答函数
    function processAnswer(answerEl) {
        if (!answerEl?.isConnected) return

        return withRetry(async () => {
            const isExpanded = !answerEl.querySelector(config.selectors.expandButton)
            const header = answerEl.querySelector(config.selectors.header)
            const existingBtn = answerEl.querySelector('.zh-select-btn')

            if (!isExpanded || !header) {
                existingBtn?.remove()
                return
            }

            if (!existingBtn) {
                const btn = createSelectButton()
                const debouncedSelect = debounce((e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    selectContent(answerEl)
                }, 200)

                btn.onclick = debouncedSelect

                if (!header.style.position) {
                    header.style.position = 'relative'
                }

                header.appendChild(btn)
                setupKeyboardShortcuts(answerEl, btn)
            }
        })
    }

    // 优化的观察器
    const observer = new MutationObserver(
        debounce((mutations) => {
            const processed = new Set()

            for (const mutation of mutations) {
                const answerEl = mutation.target.closest(config.selectors.answer)
                if (answerEl && !processed.has(answerEl)) {
                    processed.add(answerEl)
                    processAnswer(answerEl).catch(console.warn)
                }
            }
        }, 100)
    )

    // 初始化
    function init() {
        try {
            // 处理现有回答
            const answers = document.querySelectorAll(config.selectors.answer)
            console.log('找到回答数量:', answers.length)
            answers.forEach(processAnswer)

            // 监听变化
            observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class'],
            })
            console.log('观察器已启动')
        } catch (err) {
            console.warn('初始化时出错:', err)
        }
    }

    // 确保DOM加载完成后运行
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init)
    } else {
        init()
    }
})()
