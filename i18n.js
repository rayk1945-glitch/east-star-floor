/* East Star floor app: English / 中文 UI switch (index.html + client.html).
 * Default English; the choice is remembered on this device (localStorage "esLang"). Tap any [data-lang-toggle] button.
 * How it works: the pages are written in English. In 中文 mode every UI text node and placeholder / aria-label / title is
 * looked up in the strings table below (EX = whole text, PH = phrases and number patterns inside longer text), also for
 * everything rendered later (MutationObserver), plus confirm() / alert() texts. Item data and customer content are left as
 * they are: anything inside class="notr" (item names, descriptions, note titles), inputs and textareas is never touched.
 * Switching back restores the original English without a reload. */
(function () {
  var KEY = 'esLang', L = 'en';
  try { L = localStorage.getItem(KEY) === 'zh' ? 'zh' : 'en'; } catch (e) {}

  // ---------------------------------------------------------------- strings table: whole texts (trimmed)
  var EX = {
    // header / nav / sign in
    'East Star': '劍鋒高級建材', 'East Star Red': '劍鋒高級建材 Red', 'Sign in': '登录', 'Sign out': '退出', 'Admin': '管理', 'Search': '搜索', 'Project': '项目', 'Projects': '项目',
    'History': '历史', 'Requests': '请求', 'Name': '姓名', 'PIN': '密码 (PIN)', 'Refresh': '刷新', 'All': '全部', 'Carts': '购物车', 'Plans': '图纸', 'From': '从', 'To': '到',
    'Showroom floor: stock, prices, tile calculator, projects. Staff only. Ask admin for a login.': '展厅工具：库存、价格、瓷砖计算器、项目。仅限员工，请向管理员 索取登录账号。',
    'Set your own PIN': '设置你自己的密码', 'You were given a temporary PIN. Pick your own 4 to 10 digit PIN.': '你收到的是临时密码。请设置 4 到 10 位数字的新密码。',
    'New PIN': '新密码', 'New PIN again': '再次输入新密码', 'Save PIN': '保存密码',
    'Typos are OK. Model numbers, colors, sizes and words all work.': '可以有错字。型号、颜色、尺寸和文字都能搜。',
    'Recent searches': '最近搜索', 'Recent': '最近', 'Clear': '清除', 'Did you mean': '你是不是要找', 'No match': '没有结果', 'Nothing found': '没有找到',
    'No exact match, showing close matches': '没有完全匹配，显示相近结果', 'No match with these filters': '这些筛选条件下没有结果',
    'Nothing here with these filters. Tap a chip again to clear it.': '这些筛选条件下没有结果。再点一次标签即可取消。',
    'In stock': '有货', 'SF shelf': 'SF 货架', 'Fremont shelf': 'Fremont 货架', 'FRE shelf': 'FRE 货架', 'Stock by store': '各店库存', 'Finish': '表面',
    'Could not switch to ': '无法换成 ',
    'Chrome': '铬', 'Polished Chrome': '抛光铬', 'Polished Nickel': '抛光镍', 'Brushed Nickel': '拉丝镍', 'Satin Nickel': '缎面镍',
    'Brushed Bronze': '拉丝青铜', 'Oil Rubbed Bronze': '油擦青铜', 'Venetian Bronze': '威尼斯青铜', 'Champagne Bronze': '香槟青铜',
    'Brushed Brass': '拉丝黄铜', 'Unlacquered Brass': '未上漆黄铜', 'Polished Brass': '抛光黄铜', 'Brushed Gold': '拉丝金',
    'Brushed Gold Optic': '拉丝金', 'Brushed Black Chrome': '拉丝黑铬', 'Brushed Black': '拉丝黑', 'Matte Black': '哑光黑',
    'Matte White': '哑光白', 'Stainless Steel': '不锈钢', 'SuperSteel': '超级钢', 'Gunmetal': '枪灰', 'Brushed Graphite': '拉丝石墨',
    'Hard Graphite': '硬石墨', 'Warm Sunset': '暖日', 'Cool Sunrise': '冷日',
    'On hand': '现货', 'On order': '已订购', 'Incoming': '在途', 'After ctnrs': '到柜后', 'retail': '零售价', 'per piece': '每片', 'Price': '价格',
    'Add to note': '加入笔记', 'Tile calculator': '瓷砖计算器', '▦ Tile calculator': '▦ 瓷砖计算器', 'discontinued': '已停产', 'partly received': '部分到货',
    'Adding to:': '添加到：', 'Adding to': '添加到', 'pick a project': '选择项目', 'change': '更换', '+ New project': '+ 新项目', 'New project with the next number': '用下一个编号新建项目',
    'Clear search': '清除搜索', 'Dismiss': '关闭', 'Edit': '编辑', 'Remove': '删除', 'Delete': '删除', 'Install': '安装', 'Upload': '上传', 'Now': '现在', 'None': '无', 'None yet.': '暂无。',
    'Search: matte black faucet, 12x24 white, 15714…': '搜索：哑光黑龙头、12x24 白色、15714…',
    // projects / notes
    'Back to projects': '返回项目列表', '+ Add contact info': '+ 添加联系信息', 'Hide contact info ▴': '收起联系信息 ▴', 'Address': '地址', 'Phone': '电话',
    'SF tax 8.625%': 'SF 税 8.625%', 'Fremont tax 10.25%': 'Fremont 税 10.25%', 'Changes save automatically.': '修改会自动保存。',
    'Share': '分享', 'Share to team': '分享给团队', 'Sharing': '已分享', 'Share with client': '分享给客户', 'Client link on': '客户链接已开', 'Private to you': '仅自己可见',
    '● Record voice note': '● 录语音笔记', '■ Stop': '■ 停止', '▶ Play': '▶ 播放', 'Remove this voice note?': '删除这条语音笔记？',
    'Transcript / summary (optional)': '文字记录 / 摘要（可选）', '+ Add note': '+ 添加笔记', '+ New note': '+ 新笔记', 'Save project': '保存项目', 'Saved ✓': '已保存 ✓',
    'Saving…': '保存中…', 'Not saved, tap to retry': '没保存，点这里重试', 'Not saved yet': '还没保存', 'Not saved yet (will retry)': '还没保存（会自动重试）',
    'Not saved yet. Check the connection and try again.': '还没保存。请检查网络后重试。',
    'Quote this note': '为这个笔记报价', 'Quote this note (open a note first)': '为这个笔记报价（先打开一个笔记）', 'Delete this project': '删除这个项目', 'Delete this note': '删除这个笔记',
    'Note title': '笔记标题', 'Collapse note': '收起笔记', 'Note actions': '笔记操作', 'Add items from Search here': '在这里添加搜索到的商品', 'Items': '商品', 'Photos': '照片', 'Notes': '备注',
    '+ Add from Search': '+ 从搜索添加', '📷 Add photo': '📷 添加照片', 'No photos yet.': '还没有照片。', 'Remove photo': '删除照片', 'adding here': '正在添加到这里',
    'What they want, colors, measurements, timing': '客户想要什么、颜色、尺寸、时间', 'Note: color, size…': '备注：颜色、尺寸…', 'Move or copy': '移动或复制',
    'no longer in the item list': '已不在商品清单中', 'Move to…': '移动到…', 'Copy to…': '复制到…', 'Clone note': '复制笔记', 'Clone to another project…': '复制到另一个项目…',
    'No other projects.': '没有其他项目。', 'No projects yet. Tap + New project.': '还没有项目。点 + 新项目。', 'No projects yet. Tap Project below to start one.': '还没有项目。点下面的「项目」开始。',
    'No project matches.': '没有匹配的项目。', 'No notes yet. Tap + Add note.': '还没有笔记。点 + 添加笔记。', 'No items in this note yet. Add items from Search first.': '这个笔记还没有商品。请先从搜索添加。',
    'Items from Search go into this note.': '搜索到的商品会加入这个笔记。', 'Pick a project, then which of its notes items from Search go into.': '先选项目，再选搜索商品要加入哪个笔记。',
    'Add to which project?': '加入哪个项目？', 'Starting a new project…': '正在新建项目…', 'Search name, phone or #number': '搜索姓名、电话或 #编号', '#number, name, phone': '#编号、姓名、电话',
    'Note deleted': '笔记已删除', 'Sharing saved': '分享设置已保存', 'Not shared any more': '已取消分享', 'Everyone on my team': '我团队的所有人',
    'every staff login of this account, now and later': '这个账户现在和以后的所有员工', 'No other staff logins yet.': '还没有其他员工账号。', 'Save sharing': '保存分享设置',
    'the team': '团队', 'your whole team': '你的整个团队', 'shared': '已分享', 'Cloning…': '复制中…', 'Creating…': '创建中…', 'Working…': '处理中…', 'Loading…': '加载中…', 'Editing…': '编辑中…',
    'Project not found.': '找不到这个项目。', 'This project has no note yet. Tap + Add note.': '这个项目还没有笔记。点 + 添加笔记。', 'That note is gone.': '这个笔记已不存在。',
    'Name is required.': '必须填写姓名。', 'This project is full': '这个项目已满', 'Copy as project': '复制成项目',
    // client link sheet
    'Make client link': '生成客户链接', 'Copy link': '复制链接', 'Copied ✓': '已复制 ✓', 'Share… (text it)': '分享…（发短信）', 'Preview': '预览', 'New link': '新链接', 'Stop client link': '停用客户链接',
    'Client link ready': '客户链接已生成', 'Client link copied': '客户链接已复制', 'Client link stopped': '客户链接已停用', 'New client link (old one stopped)': '已生成新链接（旧链接已停用）',
    'No prices, totals, stock or shelf locations.': '不含任何价格、总价、库存或货架位置。', 'No sign-in needed: anyone with the link can see it.': '无需登录：有链接的人都能看到。',
    'Make a new link? The old link stops working right away.': '生成新链接？旧链接会立即失效。', 'Stop the client link? Anyone who has it can no longer open this project.': '停用客户链接？有这个链接的人将无法再打开这个项目。',
    // tile calculator
    'Area (sq ft)': '面积（平方英尺）', 'Waste %': '损耗 %', 'Pieces': '片数', 'Covers': '覆盖', 'Boxes (reference)': '箱数（参考）', 'Tile cost (retail)': '瓷砖费用（零售价）', 'Enter the area first': '请先输入面积', 'Add tile to note': '把瓷砖加入笔记',
    'Set this line': '设定这一行',
    'Showroom staff: stock, prices, calculators, projects. Ask admin for a login.': '展厅员工：库存、价格、计算器、项目。请向管理员索取登录。', 'Ask admin for a login.': '请向管理员索取登录。',
    'Send plan': '发送设计图', 'the bot': '机器人', 'East Star Building Supply': '劍鋒高級建材',
    'Done': '完成', "Changes fill this line's qty (pieces) right away.": '修改会立即填入这一行的数量（片）。', "Changes fill this line's qty (boxes) right away.": '修改会立即填入这一行的数量（箱）。',
    'Flooring calculator': '地板计算器', '▦ Flooring calculator': '▦ 地板计算器', 'Sq ft per box': '每箱平方英尺', 'Add flooring to note': '把地板加入笔记', 'per box': '每箱', 'Need': '需要',
    'from the description': '取自商品描述', 'pcs/box × sq ft/pc': '每箱片数 × 每片平方英尺', 'set on this phone': '本机已修改', 'not in the description: enter it': '描述里没有：请输入',
    'Enter the sq ft per box (on the box label or price list).': '请输入每箱平方英尺（见箱子标签或价目表）。', 'Enter the sq ft per box first': '请先输入每箱平方英尺', 'Total (retail)': '合计（零售价）', 'Retail list prices, no discount. Discounts are applied on the official quote.': '零售标价，未打折。折扣在正式报价中计算。',
    'Retail today (before tax)': '今日零售价（税前）', 'Total': '合计', 'Tile': '瓷砖',
    // plan / cart
    'Send a kitchen plan to': '发送厨房图纸给', 'Goes straight to the bot for an official quote. The bot replies to East Star Building Supply with the quote JPG and CSV.': '直接发给机器人做正式报价。机器人会把报价 JPG 和 CSV 回复给 East Star Building Supply。',
    'Plan photo or PDF': '图纸照片或 PDF', 'Style': '款式', 'Pick style…': '选择款式…', 'default for style': '按款式默认', 'Discount %': '折扣 %', 'Tax': '税', 'SF 8.625%': 'SF 8.625%', 'Fremont 10.25%': 'Fremont 10.25%',
    'Job city': '工地城市', 'e.g. Hercules': '例如 Hercules', 'Trim (blank = none)': '配件（空白 = 不要）', 'Trim': '配件', 'Other (see notes)': '其他（见备注）',
    'Fridge side, hinge notes, anything unclear on the plan': '冰箱侧板、门铰方向、图纸上不清楚的地方', 'Cabinet codes on the plan': '图纸上的柜子代码', 'Read again': '重新读取', 'Read fresh': '从头读取',
    'Read by the computer from the photo: check every code and quantity against the plan.': '由电脑从照片读取：请对照图纸检查每个代码和数量。', '+ Add row': '+ 添加一行',
    '= not in our item list,': '= 不在我们的商品清单中，', '= the reader guessed or the label looks cut off.': '= 读取时是猜的，或标签看起来被截断。', 'check': '核对', 'odd': '可疑',
    'Send this list': '发送这个清单', 'Recently sent plans': '最近发送的图纸', 'All history ›': '全部历史 ›', 'Pick the plan photo first.': '请先选图纸照片。',
    'Reading cabinet codes from the plan…': '正在从图纸读取柜子代码…', 'Could not read the plan.': '无法读取图纸。', 'Could not read the photo.': '无法读取照片。', 'Trying again…': '正在重试…',
    'Google is still busy reading photos.': 'Google 仍在忙着读取照片。', 'Sending…': '发送中…', 'Send to bot': '发给机器人', 'Cart request': '购物车请求', 'Plan request': '图纸请求',
    'Read the codes again? Your edits to the list will be replaced.': '重新读取代码？你对清单的修改会被替换。', 'Read the photo again from scratch? Your edits to the list will be replaced.': '从头重新读取照片？你对清单的修改会被替换。',
    'Tap “Read again” to read cabinet codes from this photo.': '点「重新读取」从这张照片读取柜子代码。', 'Copied into a new plan form': '已复制到新的图纸表单', 'Revised from': '修改自',
    'No cabinet codes found on this photo. You can still send the photo alone, or add the codes yourself.': '这张照片上没找到柜子代码。你仍然可以只发照片，或自己添加代码。',
    'You can still send the photo alone, or add the codes yourself.': '你仍然可以只发照片，或自己添加代码。', 'You can still send the photo alone.': '你仍然可以只发照片。',
    'Cabinet list (staff-confirmed)': '柜子清单（员工已确认）', 'Stop editing': '停止编辑', 'Editing': '正在编辑', 'Open': '打开', 'Re-send': '重新发送', 'Clone': '复制',
    'That file is over 10 MB. Take the photo again at a lower size.': '文件超过 10 MB。请用较小尺寸重新拍照。', 'This PDF is too big to read (over 1 MB). A screenshot of the plan works better.': '这个 PDF 太大无法读取（超过 1 MB）。截图效果更好。',
    'This photo type cannot be read here (try a JPG/PNG screenshot).': '这种照片格式无法在这里读取（试试 JPG/PNG 截图）。', 'This photo type is not supported here. Try a JPG.': '不支持这种照片格式。请用 JPG。',
    'Microphone blocked. Allow it in the browser settings.': '麦克风被阻止。请在浏览器设置中允许。', 'This browser cannot record. Type a note instead.': '这个浏览器无法录音。请改为打字记录。',
    // admin
    'Admin: accounts': '管理：账户', 'One account per bot. Webhook URL + key are write-only: they are stored on the server and never shown again.': '每个机器人一个账户。Webhook 网址和密钥只能写入：保存在服务器上，之后不再显示。',
    'Add an account': '添加账户', 'Account ID': '账户 ID', 'Bot name': '机器人名称', 'Account name': '账户名称', 'CSV customer ID': 'CSV 客户编号', 'e.g. phone + name used in NetSuite': '例如 NetSuite 里用的电话 + 姓名',
    "Plan share email (bot owner's Google account)": '图纸共享邮箱（机器人主人的 Google 账号）', 'Save account': '保存账户', 'Account saved.': '账户已保存。', 'Staff': '员工', 'Add a login': '添加登录账号',
    'Temporary PIN; they set their own at first sign-in. Same name again = reset PIN.': '临时密码；对方第一次登录时设置自己的密码。再次输入同一个名字 = 重设密码。',
    'Temporary PIN': '临时密码', 'Account': '账户', 'Role': '角色', 'staff': '员工', 'account admin': '账户管理员', 'admin (all accounts)': '管理员（所有账户）', 'Add / reset login': '添加 / 重设账号',
    'Active': '启用', 'Paused': '已暂停', 'Signed in now': '正在登录中', 'Pause': '暂停', 'Resume': '恢复', 'Reset PIN': '重设密码', 'No logins.': '没有账号。', 'never signed in': '从未登录', 'paused or removed': '已暂停或已删除',
    'Webhook URL': 'Webhook 网址', 'Webhook key': 'Webhook 密钥', 'Save webhook': '保存 Webhook', 'Ping bot': '测试机器人', 'Pinging…': '测试中…', 'webhook set': 'Webhook 已设置', 'no webhook': '没有 Webhook',
    "Set webhook (from the bot's routine panel)": '设置 Webhook（从机器人的例程面板复制）', 'Send to bot account': '发送到机器人账户', 'Send plans & carts to': '图纸和购物车发送给', 'Send to bot': '发给机器人',
    'They are signed out and must pick their own PIN at the next sign-in. Give them the temporary PIN in person.': '对方会被登出，下次登录时必须设置自己的密码。请当面把临时密码告诉对方。',
    // install hint
    'Install East Star': '安装劍鋒高級建材', 'Full screen:': '全屏：', 'Add to Home Screen': '添加到主屏幕', 'Add to Home screen': '添加到主屏幕', 'for full screen, like an app.': '即可像 App 一样全屏使用。',
    'tap Share': '点「分享」', 'tap ⋮ then': '点 ⋮ 然后', 'then': '然后', '(or Install app).': '（或「安装应用」）。',
    'Prices shown Mon–Sat 8:30 AM–5:30 PM': '价格显示时间：周一至周六 8:30–17:30', 'just now': '刚刚',
    // server messages
    'Wrong name or PIN.': '姓名或密码错误。', 'This login is paused. Ask admin.': '这个账号已暂停。请联系管理员。', 'This account is turned off. Ask admin.': '这个账户已关闭。请联系管理员。',
    'Your account is turned off. Ask admin.': '你的账户已关闭。请联系管理员。', 'Please sign in.': '请登录。', 'Your session has expired. Please sign in again.': '登录已过期，请重新登录。',
    'This login was paused or removed. Ask admin.': '这个账号已被暂停或删除。请联系管理员。', 'PIN must be 4 to 10 digits.': '密码必须是 4 到 10 位数字。', 'The two PINs do not match.': '两次输入的密码不一致。',
    'Current PIN is wrong.': '当前密码错误。', 'Customer name is required.': '必须填写客户姓名。', 'Discount must be 0 to 60%.': '折扣必须在 0 到 60% 之间。', 'The cart is empty.': '购物车是空的。',
    'Add a photo or PDF of the plan.': '请添加图纸照片或 PDF。', 'Plan must be a photo (JPG, PNG, HEIC, WebP) or a PDF.': '图纸必须是照片（JPG、PNG、HEIC、WebP）或 PDF。',
    'That file is too big (max about 10 MB).': '文件太大（最大约 10 MB）。', 'File too big (max about 6 MB).': '文件太大（最大约 6 MB）。', 'Request not found.': '找不到这个请求。',
    'The server is busy. Try again in a few seconds.': '服务器忙，请几秒后再试。', 'No connection to the server. Check your internet and try again.': '无法连接服务器。请检查网络后重试。',
    'Something went wrong.': '出错了。', 'Only the admin can do that.': '只有管理员可以这样做。', 'Only an admin can see logins.': '只有管理员可以查看账号。', 'No such account.': '没有这个账户。', 'No such user.': '没有这个用户。',
    'You cannot pause your own login.': '不能暂停自己的账号。', 'You cannot delete your own login.': '不能删除自己的账号。', 'The admin login cannot be paused.': '管理员账号不能暂停。', 'The admin login cannot be deleted.': '管理员账号不能删除。',
    'Name must be 2 to 30 characters: letters, numbers and spaces only.': '名字须为 2 到 30 个字符：只能用字母、数字和空格。', 'Pick a different note.': '请选另一个笔记。', 'Move to note': '移到其他笔记', 'Add another note first.': '请先添加另一个笔记。', 'Only the first 20 photos are added at a time.': '一次最多添加 20 张照片，只添加了前 20 张。', 'Max 20 photos per note.': '每个笔记最多 20 张照片。', 'Photos are still uploading…': '照片仍在上传…', 'Drop photos here (up to 20)': '把照片拖到这里（最多 20 张）', 'or paste (Ctrl+V)': '或粘贴 (Ctrl+V)', 'or drag a file here / paste (Ctrl+V)': '或把文件拖到这里 / 粘贴 (Ctrl+V)', 'One plan file per request: using the first one.': '每个请求只能一个平面图文件：已使用第一个。', 'Use a photo or PDF for the plan.': '平面图请用照片或 PDF。', 'That note already has 20 photos.': '那个笔记已经有 20 张照片了。', 'Photo not found.': '找不到照片。', 'File not found.': '找不到文件。',
    'Webhook URL must start with https://': 'Webhook 网址必须以 https:// 开头', 'That key looks wrong (no spaces, at least 16 characters).': '密钥看起来不对（不能有空格，至少 16 个字符）。',
    'Account name, bot name and CSV customer ID are required.': '必须填写账户名称、机器人名称和 CSV 客户编号。', 'That name belongs to another account. Pick another name.': '这个名字属于另一个账户。请换一个名字。',
    'No item data yet. Ask admin to sync the item list.': '还没有商品数据。请让管理员同步商品清单。', 'This link is no longer active. Ask East Star for a new one.': '这个链接已失效。请向劍鋒索取新链接。',
    // client page
    'Questions? Visit or call us': '有问题？欢迎来店或致电', 'Your project': '你的项目', 'Nothing has been added to this project yet.': '这个项目还没有添加内容。',
    'This link is not complete. Ask East Star for the link again.': '这个链接不完整。请向劍鋒重新索取链接。', 'No connection. Check your internet and reload the page.': '无法连接。请检查网络后刷新页面。',
    'San Francisco': '旧金山', 'Fremont': 'Fremont',
    // passwords (were PINs), rename, fingerprint / Face ID
    'Change my password': '修改我的密码', 'warehouse': '仓库', 'Warehouse logins can only search items and stock.': '仓库账号只能搜索商品和库存。', 'Current password': '当前密码', 'Your password is changed.': '密码已修改。', 'At least 6 characters. Letters, numbers, spaces and symbols are all OK.': '至少 6 个字符，可以用字母、数字、空格和符号。', 'Password': '密码', 'Show': '显示', 'Hide': '隐藏', 'Show password': '显示密码', 'Hide password': '隐藏密码', 'Sign in with fingerprint / Face ID': '用指纹/面容登录', 'Forget on this phone': '在这部手机上关闭', 'Set your own password': '设置你自己的密码', 'Pick your own password: at least 6 characters. Letters, numbers, spaces and symbols are all OK.': '请设置你自己的密码：至少 6 个字符，可以用字母、数字、空格和符号。', 'Current or temporary password': '当前密码或临时密码', 'New password': '新密码', 'New password again': '再次输入新密码', 'Save password': '保存密码', 'Temporary password (at least 6 characters); they set their own at first sign-in. Same name again = reset password.': '临时密码（至少 6 个字符）；对方第一次登录时设置自己的密码。再次输入同一个名字 = 重设密码。', 'Temporary password': '临时密码', 'Reset password': '重设密码', 'They are signed out and must pick their own password at the next sign-in. Give them the temporary password in person.': '对方会被登出，下次登录时必须设置自己的密码。请当面把临时密码告诉对方。', 'Rename': '改名', 'New name': '新名字', 'Remove saved devices': '移除已保存的设备', 'Change role': '更改角色', 'Role': '角色', 'Full admin': '全权管理员', 'Account admin': '账户管理员', 'Staff': '员工', 'Warehouse': '仓库', 'Full admin: everything, every account. Account admin: their own account and its staff. Staff: search, prices, projects. Warehouse: search and stock only, never prices. It takes effect on their next tap; they stay signed in.': '全权管理员：所有功能、所有账户。账户管理员：自己的账户和其员工。员工：搜索、价格、项目。仓库：只能搜索和查看库存，永远看不到价格。下次操作即生效，对方不会被登出。', 'You are the only full admin. Make someone else full admin first.': '你是唯一的全权管理员。请先把另一位设为全权管理员。', 'This is the last full admin. Make someone else full admin first.': '这是最后一位全权管理员。请先把另一位设为全权管理员。', 'Only the admin can do that.': '只有管理员可以这样做。', 'They sign in with the new name. Their projects, history, shares and saved devices stay with this login. Tell them the new name.': '对方以后用新名字登录。项目、历史、分享和已保存的设备都保留在这个账号。请把新名字告诉对方。', 'Name not changed.': '名字没有改变。', 'Use fingerprint / Face ID next time': '下次用指纹/面容登录', 'Next time, sign in on this phone with your fingerprint or face instead of typing your password. Your fingerprint and face stay on the phone; the app never sees them.': '下次在这部手机上用指纹或面容登录，不用输入密码。指纹和面容只保存在手机上，应用看不到。', 'Turn on': '开启', 'Not now': '以后再说', 'Fingerprint / Face ID is on for this phone.': '这部手机已开启指纹/面容登录。', 'Fingerprint / Face ID was cancelled.': '指纹/面容验证已取消。', 'This phone is already saved.': '这部手机已经保存过了。', 'Fingerprint / Face ID is off on this phone. Sign in with your password.': '这部手机已关闭指纹/面容登录。请用密码登录。', 'Wrong name or password.': '姓名或密码错误。', 'Password must be 6 to 128 characters.': '密码必须是 6 到 128 个字符。', 'The two passwords do not match.': '两次输入的密码不一致。', 'Current password is wrong.': '当前密码错误。', 'Pick a new password, not the same one.': '请设置一个新密码，不要和原来的一样。', 'Another login already uses that name.': '这个名字已经被其他账号使用。', 'This fingerprint / Face ID request expired. Try again.': '这次指纹/面容请求已过期，请再试一次。', 'Fingerprint / Face ID check failed. Sign in with your password.': '指纹/面容验证失败，请用密码登录。', 'This device is no longer saved for fingerprint / Face ID. Sign in with your password.': '这台设备的指纹/面容登录已被移除，请用密码登录。', 'Fingerprint / Face ID was not confirmed on the phone. Try again.': '手机上没有确认指纹/面容，请再试一次。', 'Fingerprint / Face ID is not allowed from this page.': '这个页面不能使用指纹/面容登录。', 'Too many tries. Sign in with your password.': '尝试次数太多，请用密码登录。', 'This login was removed. Ask admin.': '这个账号已被删除。请联系管理员。', 'This device is already saved.': '这台设备已经保存过了。', 'This phone offered a key type the app does not support.': '这部手机的密钥类型不受支持。', 'Bad passkey data.': '指纹/面容数据有误。',
  };

  // ---------------------------------------------------------------- phrases / patterns inside longer texts (applied in order)
  var PH = [
    [/^Send plan to /, '图纸发给 '], [/^Send to /, '发送给 '], [/^Sent to /, '已发送给 '], [/\. Request /g, '。请求 '], [/^Request /, '请求 '],
    [/ items\. The quote comes back to East Star Building Supply\./, ' 件商品。报价会回复给 East Star Building Supply。'], [/^Saved as /, '已保存为 '], [/ but the bot did not answer \(/, '，但机器人没有回应（'],
    [/\)\. Re-send it below or from History\./, '）。可在下面或历史中重新发送。'], [/\)\. Re-send it from History\./, '）。可在历史中重新发送。'],
    [/^Re-sent /, '已重新发送 '], [/^Re-send failed: /, '重新发送失败：'], [/ again \(same request ID\)\?$/, ' 再发一次（同一个请求编号）？'],
    [/^Typos are OK · data from /, '可以有错字 · 数据更新于 '], [/ · all notes save automatically/, ' · 所有笔记自动保存'], [/ · contact info \+ all notes/, ' · 联系信息 + 所有笔记'],
    [/^Saved (.+?) by (.+)$/, '已保存 $1 · $2'], [/^Saved just now/, '刚刚已保存'], [/^Saved /, '已保存 '], [/^Saved$/, '已保存'], [/\bjust now\b/g, '刚刚'], [/(\d+) min ago/g, '$1 分钟前'],
    [/^Shared with you by /, '分享自 '], [/^shared by /, '分享自 '], [/^Shared with /, '已分享给 '], [/^Contact: /, '联系信息：'], [/^Owner: /, '所有者：'],
    [/^Quote (?!this note)/, '报价：'], [/^Project #(\d+)/, '项目 #$1'], [/\bProject #(\d+)/g, '项目 #$1'], [/^Note (\d+)$/, '笔记 $1'], [/^Note (\d+) \(copy\)$/, '笔记 $1（副本）'],
    [/^Voice notes \((\d+)\)/, '语音笔记（$1）'], [/^Recording /, '录音中 '], [/^Load more \((\d+) left\)/, '加载更多（还有 $1 个）'],
    [/^(\d+) matches?\b/, '$1 个结果'], [/^(\d+) close matches?\b/, '$1 个相近结果'], [/(\d+) requests?\b/g, '$1 个请求'], [/, showing newest (\d+)/, '，显示最新 $1 个'],
    [/\b(\d+) items?\b/g, '$1 件商品'], [/\b(\d+) photos?\b/g, '$1 张照片'], [/\b(\d+) notes?\b/g, '$1 个笔记'], [/\b(\d+) projects?\b/g, '$1 个项目'], [/\b(\d+) boxes\b/g, '$1 箱'],
    [/\b([\d.]+) box(?:es)? of (\d+) pcs\b/g, '$1 箱（每箱 $2 片）'], [/\b(\d+) pcs\/box\b/g, '$1 片/箱'], [/\b(\d[\d,]*) pc\b/g, '$1 片'], [/\b(\d+) pcs\b/g, '$1 片'], [/ codes\)/g, ' 个代码）'], [/ cab codes/g, ' 个柜子代码'],
    [/\b(\d+) boxes\b/g, '$1 箱'], [/ sq ft \(([\d.]+) \+ ([\d.]+)% waste\)/, ' 平方英尺（$1 + $2% 损耗）'], [/\bsq ft\b/g, '平方英尺'], [/\/box\b/g, '/箱'], [/\/pc\b/g, '/片'],
    [/^Line: (\d+) (boxes|pcs) · (.+) \(saved automatically\)$/, '这一行：$1 $2 · $3（已自动保存）'], [/\b(\d[\d,]*) pcs\b/g, '$1 片'],
    [/^Now (\d+) (boxes|pcs)/, '目前 $1 $2'], [/\. Sets the qty \(boxes\) and the sq ft note of this line\./, '。会设定这一行的数量（箱）和平方英尺备注。'], [/ · line in /, ' · 所在笔记 '],
    [/^Switched /, '已更换 '], [/^Could not switch /, '无法更换 '], [/^Moved /, '已移动 '], [/^Copied /, '已复制 '], [/^Cloned into another project: /, '已复制到另一个项目：'], [/^Cloned: /, '已复制：'], [/ \(adding here\)/, '（正在添加到这里）'],
    [/^New note: /, '新笔记：'], [/^New project from /, '新项目，来自 '], [/^Added /, '已添加 '], [/^Not added: /, '未添加：'], [/^Not created: /, '未创建：'], [/^Loaded /, '已载入 '],
    [/^Photo saved to /, '照片已保存到 '], [/^Photo moved to /, '照片已移到 '], [/^Uploading (\d+)\/(\d+)$/, '正在上传 $1/$2'], [/^(\d+) photos saved to /, '$1 张照片已保存到 '], [/^(\d+) saved, (\d+) failed: /, '已保存 $1 张，失败 $2 张：'], [/^This note has room for (\d+) more photos \(max 20 per note\)\.$/, '这个笔记还能放 $1 张照片（每个笔记最多 20 张）。'], [/^Plan form filled for /, '已为以下客户填好图纸表单：'], [/^Cabinet list from /, '柜子清单来自 '], [/\. Check it, then send\./, '。请检查后发送。'],
    [/\. Fix anything wrong, then send\./, '。改正错误后发送。'], [/^Delete the note “/, '删除笔记「'], [/” with its /, '」及其 '], [/^Delete /, '删除 '], [/ with all its notes, photos and voice notes\?/, ' 及其所有笔记、照片和语音笔记？'],
    [/^Clone “/, '复制「'], [/” into…$/, '」到…'], [/: which note\?$/, '：哪个笔记？'], [/^Share (?=\S)/, '分享 '],
    [/^A read-only page of /, '一个只读页面：'], [/ for your client: all notes, items, qty, item notes and photos, plus our store addresses\./, '，给你的客户看：所有笔记、商品、数量、商品备注和照片，以及我们的门店地址。'],
    [/^They see this project with all its notes, and can add items, edit and quote\. Only /, '对方能看到这个项目的所有笔记，并可以添加商品、编辑和报价。只有 '], [/ \(or admin\) can change sharing or delete\./, '（或管理员）可以修改分享或删除。'], [/^you$/, '你'],
    [/^Nothing found for “/, '没有找到「'], [/^Nothing close to “/, '没有接近「'], [/”\. Try fewer words\./, '」的结果。试试少几个词。'], [/^No items yet\. On Search, tap/, '还没有商品。在搜索页点'],
    [/^last signed in /, '上次登录 '], [/ · signed in on (\d+) devices?, idle/, ' · 在 $1 台设备上登录，闲置'], [/ · temporary PIN/, ' · 临时密码'], [/ \(you\)/, '（你）'],
    [/^Pause /, '暂停 '], [/^Change role for /, '更改角色：'], [/^Change (.+) from (Full admin|Account admin|Staff|Warehouse) to (Full admin|Account admin|Staff|Warehouse)\?/, function (m, n, x, y) { var R = { 'Full admin': '全权管理员', 'Account admin': '账户管理员', 'Staff': '员工', 'Warehouse': '仓库' }; return '把 ' + n + ' 从' + R[x] + '改为' + R[y] + '？'; }], [/A full admin can see every project, change webhooks and manage every login\./, '全权管理员可以看到所有项目、修改 webhook 并管理所有登录账号。'], [/This is your own login\. You lose full admin right away\./, '这是你自己的账号，你会立即失去全权管理员权限。'], [/ is now (Full admin|Account admin|Staff|Warehouse)\.$/, function (m, x) { return ' 现在是' + { 'Full admin': '全权管理员', 'Account admin': '账户管理员', 'Staff': '员工', 'Warehouse': '仓库' }[x] + '。'; }], [/\? They are signed out now and cannot sign in until you tap Resume\./, '？对方会立即被登出，在你点「恢复」之前无法登录。'],
    [/ can sign in again\./, ' 可以再次登录了。'], [/ is paused/, ' 已暂停'], [/ and was signed out \(/, '，并已登出（'], [/^Delete the login for /, '删除这个登录账号：'], [/^Deleted /, '已删除 '],
    [/^PIN reset for /, '已重设密码：'], [/\. Give them the temporary PIN in person\./, '。请当面把临时密码告诉对方。'], [/^Reset PIN for /, '重设密码：'], [/^Webhook saved for /, '已保存 Webhook：'], [/\. Tap Ping to test\./, '。点「测试」检查。'],
    [/’s plans and carts now go to /, ' 的图纸和购物车现在发送给 '], [/ \(own account\)/g, '（本账户）'], [/ \(no webhook yet\)/g, '（还没有 Webhook）'], [/ a full admin\? They can see every project, change webhooks and manage every login\./, ' 设为完整管理员？对方能看到所有项目、修改 Webhook 并管理所有账号。'],
    [/^Make /, '设为 '], [/^Ping /, '测试 '], [/ · bot /g, ' · 机器人 '], [/ · CSV customer /g, ' · CSV 客户 '], [/^Plan photos shared with /, '图纸照片共享给 '], [/ · account /g, ' · 账户 '],
    [/ · sent (\d+)×/, ' · 已发送 $1 次'], [/^Revised from /, '修改自 '], [/^Using the plan photo from /, '使用以下请求的图纸照片：'], [/\. Pick a file below to replace it\./, '。在下面选文件可替换。'],
    [/^Google is busy, trying again in /, 'Google 忙，稍后重试：'], [/^Subtotal \(retail/, '小计（零售价'], [/^Prices shown /, '价格显示 '],
    [/^Unexpected server reply \(HTTP /, '服务器回复异常（HTTP '], [/^Wrong name or PIN\. (\d+) tries left before a (\d+)-minute lock\./, '姓名或密码错误。再错 $1 次将锁定 $2 分钟。'],
    [/^Not in the item list: /, '不在商品清单中：'], [/\. Remove and re-add them\./, '。请删除后重新添加。'], [/^Your project at East Star Building Supply:/, '你在劍鋒高級建材的项目：'],
    [/^Updated /, '更新于 '], [/^Mon – Sat 8:30 AM – 5:30 PM/, '周一至周六 8:30 – 17:30'],
    // passwords, rename, fingerprint / Face ID
    [/ · temporary password/, ' · 临时密码'], [/ · fingerprint \/ Face ID on (\d+) devices?/, ' · 指纹/面容：$1 台设备'], [/^Password reset for /, '已重设密码：'], [/\. Give them the temporary password in person\./, '。请当面把临时密码告诉对方。'], [/^Reset password for /, '重设密码：'], [/^Wrong name or password\. (\d+) tries left before a (\d+)-minute lock\./, '姓名或密码错误。再错 $1 次将锁定 $2 分钟。'], [/^This account is locked after too many wrong passwords\. Try again in (\d+) minutes\./, '错误密码次数太多，账号已锁定。请 $1 分钟后再试。'], [/^Too many wrong passwords, so this account is locked for (\d+) minutes\./, '错误密码次数太多，账号已锁定 $1 分钟。'], [/^Renamed (.+) to (.+)\. They sign in as (.+) now\.$/, '已将 $1 改名为 $2。对方现在用 $3 登录。'], [/^Rename (?=\S)/, '改名：'], [/^Remove fingerprint \/ Face ID for (.+) on all (\d+) saved devices?\?/, '移除 $1 在全部 $2 台设备上的指纹/面容登录？'], [/They sign in with their password and can turn it on again\./, '对方用密码登录，可以再次开启。'], [/^Removed (\d+) saved devices? for /, '已移除 $1 台已保存设备：'],
  ];

  function tr(s) {
    if (L !== 'zh' || s == null) return s;
    s = String(s); var t = s.trim(); if (!t || !/[A-Za-z]/.test(t)) return s;
    var i = s.indexOf(t), lead = s.slice(0, i), tail = s.slice(i + t.length);
    if (Object.prototype.hasOwnProperty.call(EX, t)) return lead + EX[t] + tail;
    var o = t; for (var k = 0; k < PH.length; k++) o = o.replace(PH[k][0], PH[k][1]);
    return lead + o + tail;
  }
  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1, NOSCRIPT: 1 }, ATTRS = ['placeholder', 'aria-label', 'title'];
  function skipped(el) {
    for (; el && el.nodeType === 1; el = el.parentNode) if (SKIP[el.tagName] || el.isContentEditable || (el.classList && el.classList.contains('notr')) || el.hasAttribute('data-lang-toggle')) return true;
    return false;
  }
  function doText(n) {
    var v = n.nodeValue; if (n.__zh !== undefined && v === n.__zh) return;
    n.__en = v; var z = tr(v); n.__zh = z; if (z !== v) n.nodeValue = z;
  }
  function doEl(el) {
    for (var i = 0; i < ATTRS.length; i++) { var a = ATTRS[i]; if (!el.hasAttribute(a)) continue;
      var v = el.getAttribute(a), st = el.__i18a || (el.__i18a = {}); if (st[a] && st[a].zh === v) continue;
      var z = tr(v); st[a] = { en: v, zh: z }; if (z !== v) el.setAttribute(a, z); }
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { if (!skipped(root.parentNode)) doText(root); return; }
    if (root.nodeType !== 1 || skipped(root)) return;
    doEl(root);
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: function (n) {
      return n.nodeType === 1 && (SKIP[n.tagName] || (n.classList && n.classList.contains('notr')) || n.hasAttribute('data-lang-toggle')) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; } });
    while (tw.nextNode()) { var n = tw.currentNode; if (n.nodeType === 3) doText(n); else doEl(n); }
  }
  function restore(root) {
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT), n = root;
    do {
      if (n.nodeType === 3) { if (n.__zh !== undefined) { if (n.nodeValue === n.__zh) n.nodeValue = n.__en; n.__zh = undefined; } }
      else if (n.__i18a) { for (var a in n.__i18a) if (n.getAttribute(a) === n.__i18a[a].zh) n.setAttribute(a, n.__i18a[a].en); n.__i18a = null; }
    } while ((n = tw.nextNode()));
  }
  var obs = new MutationObserver(function (ms) {
    if (L !== 'zh') return;
    ms.forEach(function (m) {
      if (m.type === 'childList') { for (var i = 0; i < m.addedNodes.length; i++) walk(m.addedNodes[i]); }
      else if (m.type === 'characterData') { if (!skipped(m.target.parentNode)) doText(m.target); }
      else if (m.type === 'attributes' && !skipped(m.target)) doEl(m.target);
    });
  });
  var docTitleEn = document.title;
  function paintToggles() {
    [].forEach.call(document.querySelectorAll('[data-lang-toggle]'), function (b) { b.textContent = L === 'zh' ? 'EN' : '中文'; b.setAttribute('aria-label', L === 'zh' ? 'Switch to English' : '切换到中文'); b.setAttribute('lang', L === 'zh' ? 'en' : 'zh-Hans'); });
  }
  function apply() {
    document.documentElement.lang = L === 'zh' ? 'zh-Hans' : 'en';
    if (L === 'zh') { walk(document.body); obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS }); document.title = tr(docTitleEn); }
    else { obs.disconnect(); restore(document.body); document.title = docTitleEn; }
    paintToggles();
  }
  function set(l) { L = l === 'zh' ? 'zh' : 'en'; try { localStorage.setItem(KEY, L); } catch (e) {} apply(); }
  var oc = window.confirm, oa = window.alert;
  window.confirm = function (m) { return oc.call(window, tr(m)); };
  window.alert = function (m) { return oa.call(window, tr(m)); };
  document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-lang-toggle]'); if (b) { e.preventDefault(); set(L === 'zh' ? 'en' : 'zh'); } });
  window.I18N = { lang: function () { return L; }, set: set, t: tr, setTitle: function (t) { docTitleEn = t; document.title = tr(t); } };
  if (document.body) apply(); else document.addEventListener('DOMContentLoaded', apply);
})();
