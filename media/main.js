// This script will be run within the webview itself
// It cannot access the main VS Code APIs directly.
import * as E from 'shared/elaborator/index.mjs';
(function () {
    const vscode = acquireVsCodeApi();

    // TODO: cache the various document.getElementById calls here after
    // Vue is removed; currently the elements wouldn't survive
    // rehydration

    // Handle messages sent from the extension to the webview
    window.addEventListener('message', event => {
        const message = event.data; // The json data that the extension sent
        switch (message.type) {
            case 'trace':
                clear();
                try {
                    const elaborated = E.elaborate(message.source)
                    trace(elaborated.cards, elaborated.elaborated)
                    document.getElementById('trace-information').value = message.file + ' on ' + new Date().toISOString();
                } catch (e) {
                    console.error('Error while elaborating trace', e)
                    vscode.postMessage({
                      command: 'notify',
                      value: `The trace file appears to be broken: ${e}`
                    })
                }
                break;
            case 'clear':
                clear();
                break;
            case 'progress':
                document.getElementById('loader').classList.toggle('is-active', message.state === 'on')
                break;
            default:
                break;
        }
    });

    function elide(i, str) {

        // Take into account that ' ... ' extends the string
        if (str.length < 2*i + 5)
            return str;

        return str.substring(0, i) + ' ... ' + str.substring(str.length - i)
    }

    // /////////////////////////////////////////////////////////////////////////////
    // NOTE: Goal mapping refactoring helpers
    // /////////////////////////////////////////////////////////////////////////////

    function intersect(a, b) {
        var t;
        if (b.length > a.length) t = b, b = a, a = t; // indexOf to loop over shorter
        return a.filter(function (e) {
            return b.indexOf(e) > -1;
        });
    }

    // TODO: All of these should probably have a pre-built index instead of repeatedly hammering all cards
    function ids_for_rt(rt) {

        let ids = [];

        for(var i = 0; i < window.rts.length; i++)
            if (window.rts[i] === rt)
                ids.push(i);

        return ids;
    }

    function ids_for_st(st) {

        let ids = [];

        for(var i = 0; i < window.sts.length; i++)
            if (window.sts[i] === st)
                ids.push(i);

        return ids;
    }

    function ids_for_gl(gl) {

        let ids = [];

        for(var i = 0; i < window.gls.length; i++)
            if (window.gls[i] === gl)
                ids.push(i);

        return ids;
    }

    function ids_for_rt_gl_not(rt, gl, id) {

        let rt_ids = ids_for_rt(rt);
        let gl_ids = ids_for_gl(gl);
        let it_ids = intersect(rt_ids, gl_ids);

        let ids = [];

        for(var i = 0; i < it_ids.length; i++)
            if (it_ids[i] !== id)
                ids.push(it_ids[i]);

        return ids;
    }

    function ids_for_rt_st(rt, st) {

        let rt_ids = ids_for_rt(rt);
        let st_ids = ids_for_st(st);
        let it_ids = intersect(rt_ids, st_ids);

        return it_ids;
    }

    function ids_for_rt_gl(rt, gl) {

        let rt_ids = ids_for_rt(rt);
        let gl_ids = ids_for_gl(gl);
        let it_ids = intersect(rt_ids, gl_ids);

        return it_ids;
    }

    function ids_for_rt_st_gl(rt, st, gl) {
        let rt_ids = ids_for_rt(rt);
        let st_ids = ids_for_st(st);
        let gl_ids = ids_for_gl(gl);
        let it_ids = intersect(intersect(rt_ids, st_ids), gl_ids);

        return it_ids;
    }

    function map_rt(c, rt) {

        if (window.rts.length > c)
            console.error('map_rt: RTS already has a key for index', c);

        window.rts[c] = rt;
    }

    function map_st(c, st) {

        if (window.sts.length > c)
            console.error('map_st: STS already has a key for index', c);

        window.sts[c] = st;
    }

    function map_gl(c, gl) {

        if (window.gls.length > c)
            console.error('map_gl: GLS already has a key for index', c);

        window.gls[c] = gl;
    }

    // /////////////////////////////////////////////////////////////////////////////
    // Kind wise helper functions
    // /////////////////////////////////////////////////////////////////////////////

    function goal_kind(step) {

        return step.kind;
    }

    function goal_id(step) {

        let kind = step.kind;
        let id = -1;

        if (kind == "Init") {
            id = step.value.goal_id;
        } else if (kind == "Inference") {
            id = step.value.current_goal_id;
        } else if (kind == "Findall") {
            id = step.value.findall_goal_id;
        } else if (kind == "Cut") {
            id = step.value.cut_goal_id;
        } else if (kind == "Suspend") {
            id = step.value.suspend_goal_id;
        } else if (kind == "Resume") {
            id = 'none'; // step.value.current_goal_id;
        } else if (kind == "CHR") {
            id = 'none'; // step.value.current_goal_id;
        } else {
            console.error('goal_id', 'Unknown step kind', kind);
        }

        return id;
    }

    function goal_text(step) {

        let kind = step.kind;
        let text = "";

        if (kind == "Init") {
            text = step.value.goal_text;
        } else if (kind == "Inference") {
            text = step.value.current_goal_text;
        } else if (kind == "Findall") {
            text = step.value.findall_goal_text;
        } else if (kind == "Cut") {
            text = "Cut";
        } else if (kind == "Suspend") {
            text = step.value.suspend_goal_text;
        } else if (kind == "Resume") {
            text = "Resume";
        } else if (kind == "CHR") {
            text = "CHR";
        } else {
            console.error('goal_text', 'Unknown step kind', kind);
        }

        return text;
    }

    function goal_predicate(step) {

        let kind = step.kind;
        let predicate = "";

        if (kind == "Init") {
            predicate = "? (INIT kind)";
        } else if (kind == "Inference") {
            predicate = step.value.current_goal_predicate;
        } else if (kind == "Findall") {
            predicate = "? (FINDALL kind)";
        } else if (kind == "Cut") {
            predicate = "? (CUT kind)";
        } else if (kind == "Suspend") {
            predicate = "? (SUSPEND kind)";
        } else if (kind == "Resume") {
            predicate = "? (RESUME kind)";
        } else if (kind == "CHR") {
            predicate = "? (CHR kind)";
        } else {
            console.error('goal_predicate', 'Unknown step kind', kind);
        }

        return predicate;
    }

    function goal_status(card)
    {
        let status = card.color.kind;

        return "dot-" + status.toLowerCase();
    }

    function goal_footer(card)
    {
        let status = card.color.kind;

        return "card-footer card-footer-" + status.toLowerCase();
    }

    // This one has a terrible complexity, tends to quadratic, Urf, TO BE REVIEWED

    function goal_status_label(card, steps, ds_r)
    {
        let status = card.color.kind;

        if (!status.includes("Yellow") && card.step.kind != "Inference")
            return [];

        let destinations = [];
        let ds_s = -1;
        let ds_g = -1;

        let all_attempts = card.step.value.more_successful_attempts.concat(card.step.value.more_failing_attempts);


        for(var i = 0; i < all_attempts.length; i++) {
            let step_id = all_attempts[i];
            let runt_id = card.runtime_id;
            let goal_ds = [];

            goal_ds[0] = step_id;

            const found_goal = steps.get({ step: step_id, runtime: runt_id })
            if (found_goal) {
                goal_ds[1] = found_goal.step.goalId ?? 'none';
            }

            goal_ds[2] = ids_for_rt_st_gl(ds_r, goal_ds[0], goal_ds[1])[0];
            destinations.push(goal_ds);

        }
        return destinations;
    }

    // /////////////////////////////////////////////////////////////////////////////
    // Ergonomic helper functions
    // /////////////////////////////////////////////////////////////////////////////

    function filter(text) {

        if (text == '') {
            for (var i = 0; i < window.inboxCount; i++) {
                document.getElementById(`msg-card-${window.inbox[i].card_index}`).classList.remove('hidden')
            }
            return;
        }

        for (var i = 0; i < window.inboxCount; i++) {

            if (window.filter_type == "goal") {
                var ratio = fuzzball.ratio(text, window.inbox[i].goal_text);

                document.getElementById(`msg-card-${window.inbox[i].card_index}`).classList.toggle(
                  'hidden',
                  !(ratio > 80 || window.inbox[i].goal_text.startsWith(text) || window.inbox[i].goal_text.includes(text))
                )
            }

            if (window.filter_type == "predicate") {
                var ratio = fuzzball.ratio(text, window.inbox[i].goal_predicate);

                document.getElementById(`msg-card-${window.inbox[i].card_index}`).classList.toggle(
                  'hidden',
                  !(ratio > 80 || window.inbox[i].goal_predicate.startsWith(text) || window.inbox[i].goal_predicate.includes(text))
                )
            }

            if (window.filter_type == "kind") {
                var ratio = fuzzball.ratio(text, window.inbox[i].type);
                document.getElementById(`msg-card-${window.inbox[i].card_index}`).classList.toggle(
                  'hidden',
                  !(ratio > 80 || window.inbox[i].kind.startsWith(text) || window.inbox[i].kind.includes(text))
                )
            }
        }
    }

    function back() {

        if (window.goal_navigation_index < 1)
            return;

        document.getElementById('filter').value = ''; filter('');

        window.goal_navigation_index = window.goal_navigation_index - 1;

        var previous = window.goal_navigation_stack[window.goal_navigation_index];

        window.inboxVue.showMessage(previous.msg, previous.index, { pushNavigation: false });

        scrollTo(previous.index);
    }

    function forw() {

        if (window.goal_navigation_index == window.goal_navigation_stack.length - 1)
            return;

        document.getElementById('filter').value = ''; filter('');

        window.goal_navigation_index = window.goal_navigation_index + 1;

        var following = window.goal_navigation_stack[window.goal_navigation_index];

        window.inboxVue.showMessage(following.msg, following.index, { pushNavigation: false });

        scrollTo(following.index);
    }

    function scrollTo(index) {

        document.getElementById(`msg-card-${index}`).scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // /////////////////////////////////////////////////////////////////////////////
    // Formatting functions
    // /////////////////////////////////////////////////////////////////////////////

    function format(msg) {

        let card = msg.data;
        let step = card.step;
        let kind = step.kind;

        let r_id = card.runtime_id;
        let s_id = card.step_id;

        if (kind == "Init") {

        } else if (kind == "Inference") {
            return format_inference(msg, r_id, s_id);
        } else if (kind == "Findall") {
            return format_findall(msg, r_id, s_id);
        } else if (kind == "Cut") {
            return format_cut(msg, r_id, s_id);
        } else if (kind == "Suspend") {
            return format_suspend(msg, r_id, s_id);
        } else if (kind == "Resume") {
            return format_resume(msg, r_id, s_id);
        } else if (kind == "CHR") {
            return format_CHR(msg, r_id, s_id);
        } else {
            console.error('format', 'Unknown step kind', kind);
        }

        return '<br/>Contents for ' + kind.toUpperCase() + ' card kind go here';
    }

    function format_inference(msg, r_id, s_id) {

        let card = msg.data;
        let step = card.step;
        let status = card.color.kind;

        let contents = "<hr/>";

        contents += format_failed_attempts(step.value.failed_attempts, r_id, s_id);
        contents += format_successful_attempts(step.value.successful_attempts, r_id, s_id);
        if (status.includes("Yellow") && card.step.kind == "Inference")
        {
            contents += format_more_attempts(msg.data, window.steps, r_id, s_id);
        }
        contents += format_stack(step.value.stack, r_id, s_id);

        return contents;
    }

    function format_findall(msg, r_id, s_id) {

        let card = msg.data;
        let step = card.step;

        let contents = "<hr/>";

        contents += `
<article class="panel">
  <div class="panel-heading">
    Solution
  </div>
  <div class="panel-block">
${step.value.findall_solution_text}
  </div>
  <div class="panel-element panel-element-footer"></div>
</article>
<br/>
`;

        contents += format_stack(step.value.findall_stack, r_id, s_id);

        return contents;
    }

    function format_cut(msg, r_id, s_id) {

        let card = msg.data;
        let step = card.step;

        let contents = "<hr/>";

        for(var i = 0; i < step.value.cut_victims.length; i++) {

            let element = {
                "kind": "UserRule",
                "value": step.value.cut_victims[i].cut_branch
            };

            let ds = ids_for_rt_gl(r_id, step.value.cut_victims[i].cut_branch_for_goal.goal_id)[0];

            contents += `
<article class="panel">
    <div class="panel-heading">
        Cut branch for <span onclick="inboxVue.jump(${ds});" class="has-tooltip-arrow has-tooltip-bottom" data-tooltip="Goal ID: ${step.value.cut_victims[i].cut_branch_for_goal.goal_id} - (${window.inbox[ds].rt}, ${window.inbox[ds].id})`;
	    contents += '\n\n' + step.value.cut_victims[i].cut_branch_for_goal.goal_text.replace(/['"]+/g, '');
	    contents += `">
          ${elide(20, step.value.cut_victims[i].cut_branch_for_goal.goal_text)}
        </span>
    </div>

    <div>
`;

            contents += format_rule(element, r_id, s_id);
            contents += `
    </div>
    <div class="panel-element panel-element-footer"></div>
</article>
`;
        }

        return contents;
    }

    function format_suspend(msg, r_id, s_id) {

        let card = msg.data;
        let step = card.step;

        let rule_id = r_id + '-' + s_id + '-' + 'sus' + '-' + window.rnb++;

        let ds = ids_for_rt_gl(r_id, step.value.suspend_sibling.goal_id)[0];

        let contents = "<hr/>";

        contents += `
<article class="panel">
  <div class="panel-heading">
    Sibling
  </div>
  <div>

    <div class="panel-element">
       <span style="float: right;" class="tag tag-spaced">
          <a href="#${rule_id}" data-action="collapse" class="no_jump_hack">
             <span class="mdi mdi-lambda" aria-hidden="true"></span>
          </a>
      </span>
      <span
        class="has-tooltip-arrow has-tooltip-bottom"
        ${typeof ds !== 'undefined' ? `onclick="inboxVue.jump(${ds});"` : ''}
        data-tooltip="Goal ID: ${step.value.suspend_sibling.goal_id} - - ${
          typeof ds !== 'undefined'
            ? `(${window.inbox[ds].rt}, ${window.inbox[ds].id})`
            : '(never resumed)'
        }">
        ${elide(20, step.value.suspend_sibling.goal_text)}
      </span>
    </div>
    <div id="${rule_id}" class="is-collapsible rule-inline">
        ${format_highlight_box(step.value.suspend_sibling.goal_text)}
    </div>
  </div>
  <div class="panel-element panel-element-footer"></div>
</article>
<br/>
`;


        contents += format_stack(step.value.suspend_stack, r_id, s_id);

        return contents;
    }

    function format_resume(msg, r_id, s_id) {

        let card = msg.data;
        let step = card.step;

        let contents = "<hr/>";

        contents += `
<article class="panel">
  <div class="panel-heading">
    Resumed goals (${step.value.length})
  </div>
  <div>
`;

        for(var i = 0; i < step.value.length; i++) {

            let rule_id = r_id + '-' + s_id + '-' + 'res' + '-' + window.rnb++;

            let ds = ids_for_rt_gl(r_id, step.value[i].goal_id)[0];

            contents += `
    <div class="panel-element">
      <span style="float: right;" class="tag tag-spaced">
          <a href="#${rule_id}" data-action="collapse" class="no_jump_hack">
             <span class="mdi mdi-lambda" aria-hidden="true"></span>
          </a>
      </span>
      <span onclick="inboxVue.jump(${ds});" class="has-tooltip-arrow has-tooltip-bottom" data-tooltip="Goal ID: ${step.value[i].goal_id} - (${window.inbox[ds].rt}, ${window.inbox[ds].id})">
        ${elide(20, step.value[i].goal_text)}
      </span>
    </div>
    <div id="${rule_id}" class="is-collapsible rule-inline">
        ${format_highlight_box(step.value[i].goal_text)}
    </div>
`;
        }

        contents += `
  </div>
  <div class="panel-element panel-element-footer"></div>
</article>
<br/>
`;

        return contents;
    }

    function format_CHR(msg, r_id, s_id) {
        let card = msg.data;
        let step = card.step;

        let contents = "<hr/>";

        contents += format_chr_failed_attempts(step.value.chr_failed_attempts, r_id, s_id);
        contents += format_chr_successful_attempts(step.value.chr_successful_attempts, r_id, s_id);
        contents += format_chr_store_before(step.value.chr_store_before, r_id, s_id);
        contents += format_chr_store_after(step.value.chr_store_after, r_id, s_id);

        return contents;
    }

    function format_findall(msg, r_id, s_id) {

        let card = msg.data;
        let step = card.step;

        let contents = "<hr/>";

        contents += `
<article class="panel">
  <div class="panel-heading">
    Solution
  </div>
  <div class="panel-block">
${step.value.findall_solution_text}
  </div>
  <div class="panel-element panel-element-footer"></div>
</article>
<br/>
`;

        contents += format_stack(step.value.findall_stack, r_id, s_id);

        return contents;
    }

// /////////////////////////////////////////////////////////////////////////////

    function format_failed_attempts(element, r_id, s_id)
    {
        let contents = "";

        if(element == undefined)
            return contents;

        contents = `
<article class="panel is-danger">
    <div class="panel-heading">
        Failed attempts (${element.length})
        <span id="toggle_f" class="tag" style="float:right;">Toggle</span>
    </div>
    <div>
`;

        for(var i = 0; i < element.length; i++) {
            contents += format_rule(element[i].rule, r_id, s_id);
            contents += format_events(element[i].events, r_id, s_id);
        }

        contents += `
    </div>
    <div class="panel-element panel-element-footer"></div>
</article>
`;

        return contents;
    }

    function format_successful_attempts(element, r_id, s_id)
    {
        let contents = "";

        if(element == undefined)
            return contents;

        contents = `
<article class="panel is-success">
    <div class="panel-heading">
        Successful attempts (${element.length})
        <span id="toggle_s" class="tag" style="float:right;">Toggle</span>
    </div>
    <div>
`;

        for(var i = 0; i < element.length; i++) {
            contents += format_rule(element[i].attempt.rule, r_id, s_id);
            contents += format_events(element[i].attempt.events, r_id, s_id);
            if (element[i].siblings.length)
            contents += '<div class="divider">Subgoals</div>';
            contents += format_siblings(element[i].siblings, r_id, s_id);
        }

        contents += `
    </div>
    <div class="panel-element panel-element-footer"></div>
</article>
`;

        return contents;
    }

    function format_more_attempts(card, steps, r_id, s_id)
    {
        let contents = "";

        if(card.step.value.more_successful_attempts == undefined && card.step.value.more_failing_attempts == undefined)
            return contents;

        let panel_class = "is-success";
        if (card.step.value.more_successful_attempts.length == 0)
            panel_class = "is-danger";

        contents = `
<article class="panel ${panel_class}">
    <div class="panel-heading">
        More attempts (${card.step.value.more_successful_attempts.length} / ${card.step.value.more_failing_attempts.length})
        <span id="toggle_ms" class="tag" style="float:right;">Toggle</span>
    </div>
    <div>
`;

        let destinations = goal_status_label(card, steps, r_id);

        for(var i = 0; i < destinations.length; i++) {
            contents += `
    <div class="panel-element">
      <span onclick="inboxVue.jump(${destinations[i][2]});" class="has-tooltip-arrow has-tooltip-bottom" data-tooltip="Goal ID: ${destinations[i][1]}">
        ${destinations[i][0]}
      </span>
    </div>
`;
        }

        contents += `
    </div>
    <div class="panel-element panel-element-footer"></div>
</article>
`;

        return contents;
    }

    function format_chr_failed_attempts(element, r_id, s_id) {

        let contents = "";

        if(element == undefined)
            return contents;

        contents = `
<article class="panel is-danger">
    <div class="panel-heading">
        Failed attempts (${element.length})
        <span id="toggle_f" class="tag" style="float:right;">Toggle</span>
    </div>
    <div>
`;

        for(var i = 0; i < element.length; i++) {
            contents += format_chr_attempt(element[i], r_id, s_id);
        }

        contents += `
    </div>
    <div class="panel-element panel-element-footer"></div>
</article>
`;

        return contents;
    }

    function format_chr_successful_attempts(element, r_id, s_id)
    {
        let contents = "";

        if(element == undefined)
            return contents;

        contents = `
<article class="panel is-success">
    <div class="panel-heading">
        Successful attempts (${element.length})
        <span id="toggle_s" class="tag" style="float:right;">Toggle</span>
    </div>
    <div>
`;

        for(var i = 0; i < element.length; i++) {
            contents += format_chr_successful_attempt(element[i], r_id, s_id);
        }

        contents += `
    </div>
    <div class="panel-element panel-element-footer"></div>
</article>
`;

        return contents;
    }

    function format_stack(element, r_id, s_id)
    {
        let fmt = "";

        fmt = `
<article class="panel">
    <div class="panel-heading">
        Stack
        <span id="toggle_t" class="tag" style="float:right;">Toggle</span>
    </div>

    <div>
`;

        for(var i = 0; i < element.length; i++) {

            let rr_id = element[i].runtime_id;
            let rs_id = element[i].step_id;
            let it_ids = ids_for_rt_st(rr_id, rs_id);

            fmt += format_rule(element[i].rule, rr_id, rs_id, window.gls[it_ids[0]]);
        }

        fmt += `
    </div>
    <div class="panel-element panel-element-footer"></div>
</article>
`;

        return fmt;
    }

    function format_rule(element, r_id, s_id, g_id)
    {

        const rule_type = element.kind;

        let rule_text = "";
        let rule_text_full = "";
        let rule_id = r_id + '-' + s_id + '-' + g_id + '-' + window.rnb++;

        if (rule_type == "UserRule") {
            rule_text = element.value.rule_text;
            rule_text_full = rule_text
        }

        if (rule_type == "BuiltinRule") {
            rule_text = element.value.kind.kind + ' - ' + element.value.name;
            if (element.value.payload.length !== 0) {// v2
                rule_text_full = element.value.payload.join('\n')
                rule_text += ': ' + rule_text_full;
            } else { //v1
                rule_text_full = rule_text
            }
        }

        let fmt = `
<div class="panel-element">
`;

        if(element.value.rule_loc) {

            const rule_loc_type = element.value.rule_loc.kind;

            if (rule_loc_type == "File") {

                const rule_loc_file = element.value.rule_loc.value.filename;
                const rule_loc_line = element.value.rule_loc.value.line;
                const rule_loc_column = element.value.rule_loc.value.column;
                const rule_loc_character = element.value.rule_loc.value.character;

                fmt += `
    <span style="float: right;" class="tag"
onclick="inboxVue.hop('${rule_loc_file} (${rule_loc_character}@L${rule_loc_line}:C${rule_loc_column})')"
class="has-tooltip-arrow has-tooltip-bottom" data-tooltip="${rule_loc_file} (${rule_loc_character}@L${rule_loc_line}:C${rule_loc_column})">
      ${rule_loc_type} Location
    </span>
`;
            }

            if (rule_loc_type == "Context") {

                const rule_loc_ctx = element.value.rule_loc.value;

                fmt += `
    <span style="float: right;" class="tag" class="has-tooltip-arrow has-tooltip-bottom" data-tooltip="${rule_loc_ctx}">
      ${rule_loc_type} Location
    </span>
`;
            }
        }

        fmt += `<span style="float: right;" class="tag tag-spaced">${rule_type}</span>`;

        fmt += `<span style="float: right;" class="tag tag-spaced">
                   <a href="#${rule_id}" data-action="collapse" class="no_jump_hack">
                      <span class="mdi mdi-lambda" aria-hidden="true"></span>
                   </a>
                </span>`

        if (r_id != undefined && s_id != undefined && g_id != undefined && g_id != 'none') {
            let ds = ids_for_rt_st_gl(r_id, s_id, g_id)[0];

            fmt += `<span onclick="inboxVue.jump(${ds});" class="has-tooltip-arrow has-tooltip-bottom" data-tooltip="Goal ID: ${g_id} - (${r_id}|${s_id})">`;
        } else {
            fmt += `<span>`;
        }
            fmt += `
    ${elide(20, rule_text)}
  </span>

</div>
<div id="${rule_id}" class="is-collapsible rule-inline">
    ${format_highlight_box(rule_text_full)}
</div>`;

        return fmt;
    }

    function format_events(element, r_id, s_id)
    {
        let fmt = "";

        for(var i = 0; i < element.length; i++) {

            let rule_id = r_id + '-' + s_id + '-' + 'evt' + '-' + window.rnb++;

            fmt += `<div class="panel-element">
                       <span style="float: right;" class="tag">Event</span>
                       <span style="float: right;" class="tag tag-spaced">
                          <a href="#${rule_id}" data-action="collapse" class="no_jump_hack">
                             <span class="mdi mdi-lambda" aria-hidden="true"></span>
                          </a>
                       </span>
                       <span style="float: left; margin-right: 10px;" class="tag">
                          ${element[i].kind}
                       </span>
                       <span>
                         ${elide(20, element[i].value)}
                       </span>
                    </div>
                    <div id="${rule_id}" class="is-collapsible rule-inline">
                        ${format_highlight_box(element[i].value)}
                    </div>`;

        }

        return fmt;
    }

    function format_siblings(element, r_id, s_id) // TODO: HERE - Assuming that
    {
        let fmt = "";

        for(var i = 0; i < element.length; i++) {

            let rule_id = r_id + '-' + s_id + '-' + 'sib' + '-' + window.rnb++;
            let  own_id = ids_for_rt_st(r_id, s_id);

            let idxes = ids_for_rt_gl_not(r_id, element[i].goal_id, own_id);

            let index = idxes[0];
            let entry = index == undefined ? undefined : window.inbox[index];

            let ds = ids_for_rt_gl(r_id, element[i].goal_id)[0];

            if(entry != undefined) // e.g. source cut case
            {
                let card = entry.data;
                let status = card.color.kind.toLowerCase();

                fmt += `<div class="panel-element">
                          <span class="tag tag-${status}" style="float: right;">Sibling</span>
                          <span style="float: right;" class="tag tag-spaced">
                             <a href="#${rule_id}" data-action="collapse" class="no_jump_hack">
                                <span class="mdi mdi-lambda" aria-hidden="true"></span>
                             </a>
                          </span>
                          <span onclick="inboxVue.jump(${ds});" class="has-tooltip-arrow has-tooltip-bottom" data-tooltip="Goal ID: ${element[i].goal_id}">
                             ${elide(20, element[i].goal_text)}
                          </span>
                        </div>
                        <div id="${rule_id}" class="is-collapsible rule-inline">
                            ${format_highlight_box(element[i].goal_text)}
                        </div>`;
            } else {

                fmt += `<div class="panel-element">
                          <span class="tag" style="float: right;">Sibling</span>
                          <span style="float: right;" class="tag tag-spaced">
                             <a href="#${rule_id}" data-action="collapse" class="no_jump_hack">
                                <span class="mdi mdi-lambda" aria-hidden="true"></span>
                             </a>
                          </span>
                          <span onclick="inboxVue.jump(${ds});" class="has-tooltip-arrow has-tooltip-bottom" data-tooltip="Goal ID: ${element[i].goal_id}">
                             ${elide(20, element[i].goal_text)}
                          </span>
                        </div>
                        <div id="${rule_id}" class="is-collapsible rule-inline">
                            ${format_highlight_box(element[i].goal_text)}
                        </div>`;
            }

        }

        return fmt;
    }

    function format_chr_attempt(element, r_id, s_id) {

        let rule_id = r_id + '-' + s_id + '-' + 'cha' + '-' + window.rnb++;

        let attempt_text = element.chr_text;

        let fmt = `
<div class="panel-element">
`;

        const attempt_loc_file = element.chr_loc.filename;
        const attempt_loc_line = element.chr_loc.line;
        const attempt_loc_column = element.chr_loc.column;
        const attempt_loc_character = element.chr_loc.character;

        fmt += `
    <span style="float: right;" class="tag"
onclick="inboxVue.hop('${attempt_loc_file} (${attempt_loc_character}@L${attempt_loc_line}:C${attempt_loc_column})')"
class="has-tooltip-arrow has-tooltip-bottom" data-tooltip="${attempt_loc_file} (${attempt_loc_character}@L${attempt_loc_line}:C${attempt_loc_column})">
      File Location
    </span>
    <span style="float: right;" class="tag tag-spaced">
    <a href="#${rule_id}" data-action="collapse" class="no_jump_hack">
       <span class="mdi mdi-lambda" aria-hidden="true"></span>
    </a>
</span>
`;

        fmt += `
    <span>${elide(20, attempt_text)}</span>
</div>
<div id="${rule_id}" class="is-collapsible rule-inline">
    ${format_highlight_box(attempt_text)}
</div>`;

        return fmt;
    }

    function format_chr_successful_attempt(element, r_id, s_id) {

        let fmt = format_chr_attempt(element.chr_attempt, r_id, s_id);

        fmt += '<div class="divider">Removed goals</div>';

        for(var i = 0; i < element.chr_removed_goals.length; i++) {

            let ds = ids_for_rt_gl(r_id, element.chr_removed_goals[i])[0];

            fmt += `
    <div class="panel-element">
      <span onclick="inboxVue.jump(${ds});" class="has-tooltip-arrow has-tooltip-bottom" data-tooltip="Goal ID: ${element.chr_removed_goals[i]}">
        ${element.chr_removed_goals[i]}
      </span>
    </div>
`;
        }

        fmt += '<div class="divider">New goals</div>';

        for(var i = 0; i < element.chr_new_goals.length; i++) {

            let rule_id = r_id + '-' + s_id + '-' + 'csa' + '-' + window.rnb++;

            let ds = ids_for_rt_gl(r_id, element.chr_new_goals[i].goal_id)[0];

            fmt += `
    <div class="panel-element">
       <span style="float: right;" class="tag tag-spaced">
          <a href="#${rule_id}" data-action="collapse" class="no_jump_hack">
             <span class="mdi mdi-lambda" aria-hidden="true"></span>
          </a>
      </span>
      <span onclick="inboxVue.jump(${ds});" class="has-tooltip-arrow has-tooltip-bottom" data-tooltip="Goal ID: ${element.chr_new_goals[i].goal_id}">
        ${elide(20, element.chr_new_goals[i].goal_text)}
      </span>
    </div>
    <div id="${rule_id}" class="is-collapsible rule-inline">
        ${format_highlight_box(element.chr_new_goals[i].goal_text)}
    </div>
`;

        }

        return fmt;
    }

    function format_chr_store_before(element, r_id, s_id) {

        let fmt = `
<article class="panel">
    <div class="panel-heading">
        Store before (${element.length})
        <span id="toggle_stb" class="tag" style="float:right;">Toggle</span>
    </div>

    <div>
`;

        for(var i = 0; i < element.length; i++) {

            let rule_id = r_id + '-' + s_id + '-' + 'cstb' + '-' + window.rnb++;

            let ds = ids_for_rt_gl(r_id, element[i].goal_id)[0];

            fmt += `
    <div class="panel-element">
       <span style="float: right;" class="tag tag-spaced">
          <a href="#${rule_id}" data-action="collapse" class="no_jump_hack">
             <span class="mdi mdi-lambda" aria-hidden="true"></span>
          </a>
       </span>
      <span onclick="inboxVue.jump(${ds});" class="has-tooltip-arrow has-tooltip-bottom" data-tooltip="Goal ID: ${element[i].goal_id}">
        ${elide(20, element[i].goal_text)}
      </span>
    </div>
    <div id="${rule_id}" class="is-collapsible rule-inline">
        ${format_highlight_box(element[i].goal_text)}
    </div>
`;

        }

        fmt += `
    </div>

    <div class="panel-element panel-element-footer"></div>
</article>
`;

        return fmt;
    }

    function format_chr_store_after(element, r_id, s_id) {

        let fmt = `
<article class="panel">
    <div class="panel-heading">
        Store after (${element.length})
        <span id="toggle_sta" class="tag" style="float:right;">Toggle</span>
    </div>

    <div>
`;

        for(var i = 0; i < element.length; i++) {

            let rule_id = r_id + '-' + s_id + '-' + 'csta' + '-' + window.rnb++;

            let ds = ids_for_rt_gl(r_id, element[i].goal_id)[0];

            fmt += `
    <div class="panel-element">
      <span style="float: right;" class="tag tag-spaced">
         <a href="#${rule_id}" data-action="collapse" class="no_jump_hack">
            <span class="mdi mdi-lambda" aria-hidden="true"></span>
         </a>
      </span>
      <span onclick="inboxVue.jump(${ds});" class="has-tooltip-arrow has-tooltip-bottom" data-tooltip="Goal ID: ${element[i].goal_id}">
        ${elide(20, element[i].goal_text)}
      </span>
    </div>
    <div id="${rule_id}" class="is-collapsible rule-inline">
        ${format_highlight_box(element[i].goal_text)}
    </div>
`;

        }

        fmt += `
    </div>
    <div class="panel-element panel-element-footer"></div>
</article>
`;

        return fmt;
    }

    function format_highlight_box(text) {
        return `<pre class="shiki" style="background-color: var(--shiki-color-background)"><span class="line"><span style="color: var(--shiki-color-text)">${text}</span></span></pre>`
    }

    // /////////////////////////////////////////////////////////////////////////////

    function clear() {

        if (window.inboxVue !== undefined && window.inboxCount !== undefined) {
            window.inboxVue.clear();
            window.inboxVue.clear_navigation();

            document.getElementById('filter').value = ''; filter('');
            document.getElementById('trace-information').value = '';
        }
    }

// /////////////////////////////////////////////////////////////////////////////
// Main entry point
// /////////////////////////////////////////////////////////////////////////////

    function trace(data, elaborated) {

        window.trace = data;
        window.steps = elaborated.steps;
        window.inbox = {};

// /////////////////////////////////////////////////////////////////////////////
// NOTE: Refactoring goal mapping
// /////////////////////////////////////////////////////////////////////////////

        window.rts = [];
        window.sts = [];
        window.gls = [];
        window.rnb = 0;

// /////////////////////////////////////////////////////////////////////////////

        window.goal_navigation_stack = new Array();
        window.goal_navigation_index = -1;
        window.current_rt = -1;
        window.current_id = -1;

// /////////////////////////////////////////////////////////////////////////////
// NOTE: Here: intertweening findall cards
// /////////////////////////////////////////////////////////////////////////////

        let parseSubRuns = (window, data, i, c, from) => {

// /////////////////////////////////////////////////////////////////////////////
// NOTE: FindALL Case
// /////////////////////////////////////////////////////////////////////////////

            if (window.inbox[from].kind == "Findall") {

                for (var j = 0; j < data[i].step.value.findall_cards.length; j++) {

                    if (j == 0) {
                        window.inbox[from].rt_sub.push(data[i].step.value.findall_cards[j].runtime_id);

                        if (window.inbox[from].rt_sub.length > 1) {
                            window.inbox[c - 1].card_class = "card-indented-last";
                        }
                    }

                    if (goal_kind(data[i].step.value.findall_cards[j].step) == "Init")
                        continue;

                    window.inbox[c] = {
                        id: data[i].step.value.findall_cards[j].step_id,
                        rt: data[i].step.value.findall_cards[j].runtime_id,
                        rt_sub: [],
                        data: data[i].step.value.findall_cards[j],
                        kind: goal_kind(data[i].step.value.findall_cards[j].step),
                        goal_id: goal_id(data[i].step.value.findall_cards[j].step),
                        goal_text: goal_text(data[i].step.value.findall_cards[j].step),
                        goal_text_elided: '',
                        goal_text_highlighted: '',
                        goal_text_highlighted_elided: '',
                        goal_predicate: goal_predicate(data[i].step.value.findall_cards[j].step),
                        status: goal_status(data[i].step.value.findall_cards[j]),
                        // status_label: goal_status_label(data[i].step.value.findall_cards[j], data, data[i].step.value.findall_cards[j].runtime_id),
                        card_class: "card-indented",
                        card_index: c,
                        footer: goal_footer(data[i].step.value.findall_cards[j]),
                        timestamp: null,
                    };

                    map_rt(c, window.inbox[c].rt);
                    map_st(c, window.inbox[c].id);
                    map_gl(c, window.inbox[c].goal_id);

                    c++; // Ok, that is nerdy

                    c = parseSubRuns(window, data, i, c, c - 1);
                }
            }

// /////////////////////////////////////////////////////////////////////////////
// NOTE: CHR Case
// /////////////////////////////////////////////////////////////////////////////

            if (window.inbox[from].kind == "CHR") {

                for (j = 0; j < data[i].step.value.chr_failed_attempts.length; j++) {

                    for (var k = 0; k < data[i].step.value.chr_failed_attempts[j].chr_condition_cards.length; k++) {

                        if (k == 0) {
                            window.inbox[from].rt_sub.push(data[i].step.value.chr_failed_attempts[j].chr_condition_cards[k].runtime_id);

                            if (window.inbox[from].rt_sub.length > 1) {
                                window.inbox[c - 1].card_class = "card-indented-last";
                            }
                        }

                        if (goal_kind(data[i].step.value.chr_failed_attempts[j].chr_condition_cards[k].step) == "Init")
                            continue;

                        window.inbox[c] = {
                            id: data[i].step.value.chr_failed_attempts[j].chr_condition_cards[k].step_id,
                            rt: data[i].step.value.chr_failed_attempts[j].chr_condition_cards[k].runtime_id,
                            rt_sub: [],
                            data: data[i].step.value.chr_failed_attempts[j].chr_condition_cards[k],
                            kind: goal_kind(data[i].step.value.chr_failed_attempts[j].chr_condition_cards[k].step),
                            goal_id: goal_id(data[i].step.value.chr_failed_attempts[j].chr_condition_cards[k].step),
                            goal_text: goal_text(data[i].step.value.chr_failed_attempts[j].chr_condition_cards[k].step),
                            goal_text_elided: '',
                            goal_text_highlighted: '',
                            goal_text_highlighted_elided: '',
                            goal_predicate: goal_predicate(data[i].step.value.chr_failed_attempts[j].chr_condition_cards[k].step),
                            status: goal_status(data[i].step.value.chr_failed_attempts[j].chr_condition_cards[k]),
                            // status_label: goal_status_label(data[i].step.value.chr_failed_attempts[j].chr_condition_cards[k], data, data[i].step.value.chr_failed_attempts[j].chr_condition_cards[k].runtime_id),
                            card_class: "card-indented",
                            card_index: c,
                            footer: goal_footer(data[i].step.value.chr_failed_attempts[j].chr_condition_cards[k]),
                            timestamp: null,
                        };

                        map_rt(c, window.inbox[c].rt);
                        map_st(c, window.inbox[c].id);
                        map_gl(c, window.inbox[c].goal_id);

                        c++; // Ok, that is nerdy

                        c = parseSubRuns(window, data, i, c, c - 1);
                    }
                }

                for (j = 0; j < data[i].step.value.chr_successful_attempts.length; j++) {

                    for (k = 0; k < data[i].step.value.chr_successful_attempts[j].chr_attempt.chr_condition_cards.length; k++) {

                        if (k == 0) {
                            window.inbox[from].rt_sub.push(data[i].step.value.chr_successful_attempts[j].chr_attempt.chr_condition_cards[k].runtime_id);

                            if (window.inbox[from].rt_sub.length > 1) {
                                window.inbox[c - 1].card_class = "card-indented-last";
                            }
                        }

                        if (goal_kind(data[i].step.value.chr_successful_attempts[j].chr_attempt.chr_condition_cards[k].step) == "Init")
                            continue;

                        window.inbox[c] = {
                            id: data[i].step.value.chr_successful_attempts[j].chr_attempt.chr_condition_cards[k].step_id,
                            rt: data[i].step.value.chr_successful_attempts[j].chr_attempt.chr_condition_cards[k].runtime_id,
                            rt_sub: [],
                            data: data[i].step.value.chr_successful_attempts[j].chr_attempt.chr_condition_cards[k],
                            kind: goal_kind(data[i].step.value.chr_successful_attempts[j].chr_attempt.chr_condition_cards[k].step),
                            goal_id: goal_id(data[i].step.value.chr_successful_attempts[j].chr_attempt.chr_condition_cards[k].step),
                            goal_text: goal_text(data[i].step.value.chr_successful_attempts[j].chr_attempt.chr_condition_cards[k].step),
                            goal_text_elided: '',
                            goal_text_highlighted: '',
                            goal_text_highlighted_elided: '',
                            goal_predicate: goal_predicate(data[i].step.value.chr_successful_attempts[j].chr_attempt.chr_condition_cards[k].step),
                            status: goal_status(data[i].step.value.chr_successful_attempts[j].chr_attempt.chr_condition_cards[k]),
                            // status_label: goal_status_label(data[i].step.value.chr_successful_attempts[j].chr_attempt.chr_condition_cards[k], data, data[i].step.value.chr_successful_attempts[j].chr_attempt.chr_condition_cards[k].runtime_id),
                            card_class: "card-indented",
                            card_index: c,
                            footer: goal_footer(data[i].step.value.chr_successful_attempts[j].chr_attempt.chr_condition_cards[k]),
                            timestamp: null,
                        };

                        map_rt(c, window.inbox[c].rt);
                        map_st(c, window.inbox[c].id);
                        map_gl(c, window.inbox[c].goal_id);

                        c++; // Ok, that is nerdy

                        c = parseSubRuns(window, data, i, c, c - 1);
                    }
                }
            }

// /////////////////////////////////////////////////////////////////////////////

            return c;
        };

        let c = 0;

        for (var i = 0; i < data.length; i++) {

            if (goal_kind(data[i].step) == "Init") continue;

            window.inbox[c] = {
                id: data[i].step_id,
                rt: data[i].runtime_id,
                rt_sub: [],
                data: data[i],
                kind: goal_kind(data[i].step),
                goal_id: goal_id(data[i].step),
                goal_text: goal_text(data[i].step),
                goal_text_elided: '',
                goal_text_highlighted: '',
                goal_text_highlighted_elided: '',
                goal_predicate: goal_predicate(data[i].step),
                status: goal_status(data[i]),
                // status_label: goal_status_label(data[i], data, data[i].runtime_id),
                card_class: "card",
                card_index: c,
                footer: goal_footer(data[i]),
                timestamp: null,
            };

            map_rt(c, window.inbox[c].rt);
            map_st(c, window.inbox[c].id);
            map_gl(c, window.inbox[c].goal_id);

            c++; // Ok, that is nerdy

            c = parseSubRuns(window, data, i, c, c - 1);
        }

        window.inboxCount = c;

        for (var i = 0; i < c; i++) {
        
            window.inbox[i].status_label = goal_status_label(window.inbox[i].data, window.steps, window.inbox[i].rt);
        
// /////////////////////////////////////////////////////////////////////////////
// Syntax highlighting
// /////////////////////////////////////////////////////////////////////////////

            window.inbox[i].goal_text_elided = elide(25, window.inbox[i].goal_text);

            window.inbox[i].goal_text_highlighted = format_highlight_box(window.inbox[i].goal_text)

            window.inbox[i].goal_text_highlighted_elided = format_highlight_box(window.inbox[i].goal_text_elided)

// /////////////////////////////////////////////////////////////////////////////
        }

// /////////////////////////////////////////////////////////////////////////////

        document.getElementById('message-feed').classList.remove('is-hidden')

        if (window.inboxVue !== undefined) {
            window.inboxVue.messages = window.inbox;
            window.inboxVue.stack = window.goal_navigation_stack;

            // Needs to happen after the DOM nodes are added by Vue
            window.inboxVue.$nextTick(() => {
                for(var i = 0; i < window.inboxCount; i++)
                    document.getElementById(`msg-card-${i}`).classList.remove('active')
            });

            return;
        }

        window.inboxVue = new Vue({
            el: '#tracer',
            data: {
                messages: window.inbox,
                stack: window.goal_navigation_stack,
            },
            updated: () => {
                document.querySelector('#navstack li.active')?.scrollIntoView()
            },
            methods: {

                toggleSubCards: function(runtime_ids) {

                    for(var i = 0; i < window.inboxCount; i++) {

                        for(var r = 0; r < runtime_ids.length; r++) {

                            if(window.inbox[i].rt == runtime_ids[r]) {

                                document.getElementById(`msg-card-${window.inbox[i].card_index}`).classList.toggle('hidden')
                            }
                        }
                    }
                },
                showMessage: function(msg, index, options = { pushNavigation: true, force: false }) {
                    const pushNavigation =
                        typeof options.pushNavigation === 'undefined'
                            ? true
                            : !!options.pushNavigation;
                    const force = !!options.force;

                    if(!force && msg.rt == window.current_rt && msg.id == window.current_id)
                        return;

                    window.current_rt = msg.rt;
                    window.current_id = msg.id;

                    document.getElementById('message-pane').classList.remove('is-hidden')
                    document.querySelectorAll('.card, .card-indented, .card-indented-last').forEach(c => c.classList.remove('active'))
                    document.getElementById(`msg-card-${index}`).classList.add('active')

                    let code = `
<div onclick="window.inboxVue.set_snippet(${index});">
`;
                    code += msg.goal_text_highlighted_elided;
                    code += `
</div>
`;
                    document.getElementById('message-pane-goal').innerHTML = code;

                    document.getElementById('message-pane-goal-id').textContent = msg.goal_id;

                    document.getElementById('message-pane-rid').textContent = msg.rt;
                    document.getElementById('message-pane-sid').textContent = msg.id;

// /////////////////////////////////////////////////////////////////////////////
// TODO: Card pane refactoring entry point
// /////////////////////////////////////////////////////////////////////////////

                    document.getElementById('message-pane-card-content').innerHTML = format(msg);

// /////////////////////////////////////////////////////////////////////////////

                    // /////////////////////////////////////////////////////////////////////////////
                    // NOTE: Handling the navigation stack
                    // /////////////////////////////////////////////////////////////////////////////

                    if(pushNavigation) {

                        if (window.goal_navigation_stack.length > window.goal_navigation_index) {

                            while (window.goal_navigation_stack.length > window.goal_navigation_index + 1)
                                window.inboxVue.$delete(window.inboxVue.stack, window.goal_navigation_stack.pop());
                        }

                        window.goal_navigation_index = window.goal_navigation_index + 1;
                        window.goal_navigation_stack.push({
                            goal: msg.goal_id,
                            rt: msg.rt,
                            id: msg.id,
                            active: "",
                            msg: msg,
                            index: index
                        });

                        document.getElementById('nav_clear').classList.remove('is-hidden')
                    }

                    document.getElementById('back_b').classList.toggle(
                      'inactive',
                      window.goal_navigation_stack.length <= 1 || window.goal_navigation_index === 0
                    );

                    document.getElementById('forw_b').classList.toggle(
                      'inactive',
                      window.goal_navigation_index >= window.goal_navigation_stack.length - 1
                    )

                    for(var i = 0; i < window.goal_navigation_stack.length; i++) {
                        window.goal_navigation_stack[i].active = "";
                    }

                    window.goal_navigation_stack[window.goal_navigation_index].active = "active";

                    // /////////////////////////////////////////////////////////////////////////////
                    // Toggling
                    // /////////////////////////////////////////////////////////////////////////////

                    // TODO: This element yoga feels quite unstable, since it's aware of whitespace text nodes...
                    document.getElementById('toggle_f')?.addEventListener('click', (e) => {
                        e.currentTarget.parentElement.parentElement.childNodes[3].classList.toggle('is-hidden');
                    });
                    document.getElementById('toggle_s')?.addEventListener('click', (e) => {
                        e.currentTarget.parentElement.parentElement.childNodes[3].classList.toggle('is-hidden');
                    });
                    document.getElementById('toggle_t')?.addEventListener('click', (e) => {
                        e.currentTarget.parentElement.parentElement.childNodes[3].classList.toggle('is-hidden');
                    });
                    document.getElementById('toggle_ms')?.addEventListener('click', (e) => {
                        e.currentTarget.parentElement.parentElement.childNodes[3].classList.toggle('is-hidden');
                    });
                    document.getElementById('toggle_stb')?.addEventListener('click', (e) => {
                        e.currentTarget.parentElement.parentElement.childNodes[3].classList.toggle('is-hidden');
                    });
                    document.getElementById('toggle_sta')?.addEventListener('click', (e) => {
                        e.currentTarget.parentElement.parentElement.childNodes[3].classList.toggle('is-hidden');
                    });

                    accordions = bulmaCollapsible.attach('.is-collapsible');

                    // TODO: I don't see a reason why this hack should stay in place
                    document.querySelectorAll('.no_jump_hack').forEach(e => e.addEventListener('click', e => {
                        e.preventDefault();
                        return false;
                    }))
                },
                clear: function() {

                    for(var i = 0; i < window.inboxCount; i++) {
                        window.inboxVue.$delete(window.inboxVue.messages, i);
                    }

                    for(var i = 0; i < window.goal_navigation_stack.length; i++) {
                        window.inboxVue.$delete(window.inboxVue.stack, i);
                    }

                    document.getElementById('message-pane').classList.add('is-hidden')

                    window.inboxCount = 0;
                },
                clear_navigation: function() {
                    window.goal_navigation_index = -1;

                    while(window.goal_navigation_stack.length > 0)
                        window.goal_navigation_stack.pop();

                    document.getElementById('back_b').classList.add('inactive');
                    document.getElementById('forw_b').classList.add('inactive');

                    document.getElementById('nav_clear').classList.add('is-hidden');
                },
                set_snippet: (index) => {

                    console.log('Setting snippet for index', index);

                    document.getElementById('snippet').innerHTML = window.inbox[index].goal_text_highlighted;

                    console.log(quickviews);
                    console.log(quickviews[0]);

                    quickviews[0].quickview.classList.toggle('is-active');
                    quickviews[0].emit('quickview:toggle', {
                          element: quickviews[0].element,
                        quickview: quickviews[0].quickview,
                    });
                },
                hop: function(destination) {
                    vscode.postMessage({
                        command: 'hopTo',
                        value: destination
                    });
                },
                jump: function(index) {

                    document.getElementById('filter').value = ''; filter('');

                    if (index !== undefined) {
                        window.inboxVue.showMessage(window.inbox[index], index);

                        scrollTo(index);

                    }
                },
                switchTo: function(index, runtime, step) {

                    document.getElementById('filter').value = ''; filter('');

                    window.goal_navigation_index = index;

                    var destination = window.goal_navigation_stack[window.goal_navigation_index];

                    window.inboxVue.showMessage(destination.msg, destination.index, { pushNavigation: false, force: true });

                    scrollTo(ids_for_rt_st(runtime, step)[0]);
                }
            }
        });
    }

    // /////////////////////////////////////////////////////////////////////////////
    // Initial display
    // /////////////////////////////////////////////////////////////////////////////

    trace({}, {});

    window.filter_type = "goal";

    // /////////////////////////////////////////////////////////////////////////////
    // Filtering
    // /////////////////////////////////////////////////////////////////////////////

    // use the "input" event for filtering on each keystroke instead
    // NB: not triggered by programatically setting `value`
    document.getElementById('filter').addEventListener('change', e =>
      filter(e.target.value)
    )

    document.getElementById('back_b').addEventListener('click', () => back());
    document.getElementById('forw_b').addEventListener('click', () => forw());

    // /////////////////////////////////////////////////////////////////////////////
    // Filtering section
    // /////////////////////////////////////////////////////////////////////////////

    document.querySelectorAll('.dropdown:not(.is-hoverable)').forEach(d => {
        const button = d.querySelector('button');
        if (!button) {
            return;
        }
        button.addEventListener('click', e => {
            e.stopPropagation();
            d.classList.toggle('is-active')
        })
    })
    document.addEventListener('click', () => {
        document.querySelectorAll('.dropdown:not(.is-hoverable)').forEach(d => {
            d.classList.remove('is-active')
        })
    })

    document.getElementById('filter-by-goal').addEventListener('click', () => {
        document.getElementById('filter-text').textContent = 'Filter by goal';
        window.filter_type = 'goal';
        filter(document.getElementById('filter').value);
    });
    document.getElementById('filter-by-predicate').addEventListener('click', () => {
        document.getElementById('filter-text').textContent = 'Filter by predicate';
        window.filter_type = 'predicate';
        filter(document.getElementById('filter').value);
    });
    document.getElementById('filter-by-kind').addEventListener('click', () => {
        document.getElementById('filter-text').textContent = 'Filter by kind';
        window.filter_type = 'kind';
        filter(document.getElementById('filter').value);
    });

    document.getElementById('options').addEventListener('change', e => {
        vscode.postMessage({
            command: 'options_changed',
            value: e.target.value
        });
    });

    var quickviews = bulmaQuickview.attach();
    var accordions;
}());
